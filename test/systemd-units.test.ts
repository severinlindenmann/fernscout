import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * The unit files in `deploy/`, read the way systemd reads them: as sections.
 *
 * B203 is why this exists. `deploy/fernscout-backup.service` carried
 *
 *     OnFailure=fernscout-alert@%n.service
 *
 * for weeks, inside `[Service]`. `OnFailure=` is a `[Unit]` directive, so
 * systemd parsed the file, logged `Unknown key 'OnFailure' in section
 * [Service], ignoring`, and loaded a backup unit that could tell nobody it had
 * failed. Every check anyone had — including the one in
 * `test/install-units.test.ts`, and including the acceptance line on B64 —
 * asked whether the *line* was present. The line was present. The behaviour
 * was missing.
 *
 * A misplaced directive is the quietest defect systemd has: the file parses,
 * the unit loads, `systemctl status` is green, and the directive simply does
 * not exist. Nothing downstream can notice, because from systemd's point of
 * view nothing was ever asked for.
 *
 * So this file parses the shipped units itself and checks every directive
 * against the section it belongs in. The table below is an **allow-list, on
 * purpose**: a directive that is not in it fails the test rather than passing
 * unexamined. Adding one is a two-line edit and a look at
 * `man systemd.directives`, which is precisely the moment somebody should be
 * checking which section it goes in.
 *
 * `systemd-analyze verify` is the authority, and it is run below wherever it
 * exists: on the VPS through `scripts/install-units.sh`, and on any Linux
 * runner — B226 is the open question of whether CI's is one. It is not
 * available on macOS, which is where these files are edited, so it cannot be
 * the only check; the table is what runs everywhere.
 */

const UNIT_SRC = path.join(process.cwd(), "deploy");

type Section = "Unit" | "Install" | "Service" | "Timer";

/**
 * Directive → the sections systemd accepts it in.
 *
 * Only the directives these units actually use, plus the handful of
 * neighbours that are known traps — a directive one would reasonably expect
 * to live in `[Service]` and which does not:
 *
 *   - `OnFailure=`, `OnSuccess=`: `[Unit]`. B203.
 *   - `StartLimitIntervalSec=`, `StartLimitBurst=`: `[Unit]` since systemd
 *     229. They *were* `[Service]` before that, so half the examples on the
 *     internet still put them there, and systemd ignores them silently.
 *   - `Restart=`/`RestartSec=`: `[Service]`, unlike the two above, which is
 *     what makes the pair so easy to get wrong together.
 *   - `Requires=`/`Wants=`/`After=`: `[Unit]`, never `[Service]`.
 */
const DIRECTIVES: Record<string, readonly Section[]> = {
  // [Unit]
  Description: ["Unit"],
  Documentation: ["Unit"],
  After: ["Unit"],
  Before: ["Unit"],
  Wants: ["Unit"],
  Requires: ["Unit"],
  Requisite: ["Unit"],
  BindsTo: ["Unit"],
  PartOf: ["Unit"],
  Conflicts: ["Unit"],
  OnFailure: ["Unit"],
  OnSuccess: ["Unit"],
  OnFailureJobMode: ["Unit"],
  StartLimitIntervalSec: ["Unit"],
  StartLimitBurst: ["Unit"],
  ConditionPathExists: ["Unit"],
  RefuseManualStart: ["Unit"],
  DefaultDependencies: ["Unit"],

  // [Install]
  WantedBy: ["Install"],
  RequiredBy: ["Install"],
  Also: ["Install"],
  Alias: ["Install"],
  DefaultInstance: ["Install"],

  // [Service]
  Type: ["Service"],
  ExecStart: ["Service"],
  ExecStartPre: ["Service"],
  ExecStartPost: ["Service"],
  ExecStop: ["Service"],
  ExecStopPost: ["Service"],
  ExecReload: ["Service"],
  Restart: ["Service"],
  RestartSec: ["Service"],
  RemainAfterExit: ["Service"],
  User: ["Service"],
  Group: ["Service"],
  SupplementaryGroups: ["Service"],
  WorkingDirectory: ["Service"],
  Environment: ["Service"],
  EnvironmentFile: ["Service"],
  TimeoutStartSec: ["Service"],
  TimeoutStopSec: ["Service"],
  TimeoutSec: ["Service"],
  StandardInput: ["Service"],
  StandardOutput: ["Service"],
  StandardError: ["Service"],
  SyslogIdentifier: ["Service"],
  NoNewPrivileges: ["Service"],
  PrivateTmp: ["Service"],
  ProtectSystem: ["Service"],
  ProtectHome: ["Service"],
  ReadWritePaths: ["Service"],
  ReadOnlyPaths: ["Service"],
  StateDirectory: ["Service"],
  RuntimeDirectory: ["Service"],
  LogsDirectory: ["Service"],
  UMask: ["Service"],
  Nice: ["Service"],
  KillMode: ["Service"],
  KillSignal: ["Service"],
  LimitNOFILE: ["Service"],

  // [Timer]
  OnCalendar: ["Timer"],
  OnBootSec: ["Timer"],
  OnStartupSec: ["Timer"],
  OnUnitActiveSec: ["Timer"],
  OnUnitInactiveSec: ["Timer"],
  OnActiveSec: ["Timer"],
  RandomizedDelaySec: ["Timer"],
  FixedRandomDelay: ["Timer"],
  AccuracySec: ["Timer"],
  Persistent: ["Timer"],
  WakeSystem: ["Timer"],
  RemainAfterElapse: ["Timer"],
  Unit: ["Timer"],
};

/** The sections each kind of unit file may contain. A `[Timer]` block in a
 * .service file is the same class of mistake as a directive in the wrong
 * section, and systemd treats it the same way: silently. */
const SECTIONS_FOR: Record<string, readonly Section[]> = {
  ".service": ["Unit", "Service", "Install"],
  ".timer": ["Unit", "Timer", "Install"],
};

type Line = { section: string; key: string; line: number };

/** The unit file as systemd sees it: a directive is in whatever section header
 * last appeared above it. Comments, blank lines and continuations are dropped;
 * a value is never looked at, only where its key sits. */
function parseUnit(text: string): { sections: string[]; lines: Line[] } {
  const sections: string[] = [];
  const lines: Line[] = [];
  let section = "";
  let continued = false;

  text.split("\n").forEach((raw, i) => {
    const wasContinued = continued;
    // A trailing backslash continues the *value*, so the next line is not a
    // directive of its own and must not be read as one.
    continued = /\\\s*$/.test(raw);
    if (wasContinued) return;

    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) return;

    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      section = header[1];
      sections.push(section);
      return;
    }

    const eq = line.indexOf("=");
    if (eq <= 0) return;
    // `-Key=` and `Key=` are the same directive; the dash only says "ignore
    // failures" on Exec lines and on EnvironmentFile.
    lines.push({ section, key: line.slice(0, eq).replace(/^-/, "").trim(), line: i + 1 });
  });

  return { sections, lines };
}

function shippedUnits(): string[] {
  return fs
    .readdirSync(UNIT_SRC)
    .filter((f) => f.endsWith(".service") || f.endsWith(".timer"))
    .sort();
}

function haveBinary(bin: string, args: string[]): boolean {
  return spawnSync(bin, args, { stdio: "ignore" }).status === 0;
}

const HAS_ANALYZE = haveBinary("systemd-analyze", ["--version"]);

describe("deploy/*.service and deploy/*.timer", () => {
  test("there are units to check at all", () => {
    // Without this the two loops below pass over an empty list, which is how a
    // renamed folder would turn this whole file into a no-op.
    expect(shippedUnits().length).toBeGreaterThanOrEqual(4);
  });

  test.each(shippedUnits())("%s puts every directive in a section systemd reads it in", (name) => {
    const file = path.join(UNIT_SRC, name);
    const { sections, lines } = parseUnit(fs.readFileSync(file, "utf8"));
    const allowed = SECTIONS_FOR[path.extname(name)];

    for (const section of sections) {
      expect(allowed, `${name} has a [${section}] section, which systemd does not read here`).toContain(
        section as Section,
      );
    }

    for (const { section, key, line } of lines) {
      const where = DIRECTIVES[key];
      expect(
        where,
        `${name}:${line} — ${key}= is not in this test's table. Look it up in ` +
          "`man systemd.directives`, add it with the section(s) it belongs to, " +
          "and the check goes back to being automatic. Do not add it blind: " +
          "putting a directive in the wrong section is the exact failure this " +
          "table exists to catch (B203).",
      ).toBeDefined();
      expect(
        where,
        `${name}:${line} — ${key}= sits in [${section}], and systemd only reads it in ` +
          `[${where?.join("] or [")}]. It parses, it loads, and the directive does nothing (B203).`,
      ).toContain(section as Section);
    }
  });

  test("the backup unit can tell somebody it failed", () => {
    // The specific line B203 is about, asserted where it has to be rather than
    // anywhere in the file. `test/install-units.test.ts` checked the latter and
    // was green throughout.
    const { lines } = parseUnit(fs.readFileSync(path.join(UNIT_SRC, "fernscout-backup.service"), "utf8"));
    const onFailure = lines.find((l) => l.key === "OnFailure");
    expect(onFailure, "a backup that fails silently is B64, and it came back as B203").toBeDefined();
    expect(onFailure!.section).toBe("Unit");
  });

  // The real thing, where it exists. It skips on macOS — there is no systemd
  // to ask — and runs on Linux CI and on the VPS, where `install-units.sh`
  // runs the same check against what it just installed.
  test.skipIf(!HAS_ANALYZE)("systemd itself finds no unknown key in any of them", () => {
    const files = shippedUnits().map((n) => path.join(UNIT_SRC, n));
    const res = spawnSync("systemd-analyze", ["verify", ...files], { encoding: "utf8" });
    const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;

    // Only the misplaced/misspelt-directive class is asserted on. The rest of
    // what `verify` says about these files is expected and not a defect: the
    // `fernscout` user does not exist on a CI runner, /srv/fernscout is not
    // there, and EnvironmentFile=/etc/fernscout/env is a deployment's, not a
    // repository's. Failing on all of `verify` would mean failing on every
    // machine that is not the VPS, which is every machine that runs this test.
    const complaints = output
      .split("\n")
      .filter((l) => /Unknown key|Unknown lvalue|Unknown section/i.test(l));
    expect(complaints, output).toEqual([]);
  });
});
