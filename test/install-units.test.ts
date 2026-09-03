import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * `scripts/install-units.sh` — the systemd half of a deploy.
 *
 * B138: `scripts/deploy.sh` pulled, built and restarted, and never once looked
 * at `deploy/*.service`. Installing a unit was a manual `cp` documented in a
 * comment in the unit's own header, so a unit change merged after the last
 * manual copy stayed behind while the deploy printed "healthy" — which is how
 * B64's `OnFailure=` handler, the entire mechanism for noticing a failed
 * backup, sat in git for two days on a server that appeared to have it.
 *
 * The script is driven here against a temporary directory standing in for
 * /etc/systemd/system, with a stub `systemctl` on PATH that records what it
 * was asked to do. That is the whole point of it being a separate script
 * rather than ten lines inside deploy.sh: the behaviour is reachable without
 * root, without systemd, and without a VPS.
 *
 * What is deliberately not covered: that systemd itself honours a reloaded
 * unit. The acceptance line about `fernscout-backup.service` carrying
 * `OnFailure=` on the deployed server is a person's check, not this file's.
 */

const REPO = process.cwd();
const SCRIPT = path.join(REPO, "scripts", "install-units.sh");
const UNIT_SRC = path.join(REPO, "deploy");

type Run = { status: number; stdout: string; stderr: string; systemctl: string[] };

/** A stub systemctl that logs its arguments and answers the two queries the
 * script makes. `active` and `enabled` are the unit names it should say yes
 * for; everything else gets a non-zero exit, which is what systemd does for a
 * unit that is neither. */
function run(
  systemdDir: string,
  { active = [] as string[], enabled = [] as string[] } = {},
): Run {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "fs-units-bin-"));
  const log = path.join(bin, "systemctl.log");
  fs.writeFileSync(
    path.join(bin, "systemctl"),
    [
      "#!/usr/bin/env bash",
      `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
      // The script calls `is-active --quiet <name>`, so the unit name is the
      // last argument rather than the second.
      'for a in "$@"; do name="$a"; done',
      "case \"$1\" in",
      `  is-active) case " ${active.join(" ")} " in *" $name "*) exit 0 ;; esac; exit 3 ;;`,
      `  is-enabled) case " ${enabled.join(" ")} " in *" $name "*) exit 0 ;; esac; exit 1 ;;`,
      "esac",
      "exit 0",
    ].join("\n"),
    { mode: 0o755 },
  );

  const res = spawnSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: {
      ...process.env,
      SYSTEMD_DIR: systemdDir,
      SYSTEMCTL: path.join(bin, "systemctl"),
      UNIT_SRC,
    },
  });

  const systemctl = fs.existsSync(log)
    ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean)
    : [];
  return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr, systemctl };
}

function tempSystemdDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fs-units-"));
}

/** Every unit the release ships. The script's job is defined against this list,
 * so the test reads it from disk rather than hardcoding names that would rot. */
function shippedUnits(): string[] {
  return fs
    .readdirSync(UNIT_SRC)
    .filter((f) => f.endsWith(".service") || f.endsWith(".timer"))
    .sort();
}

describe("install-units.sh", () => {
  test("installs every shipped unit onto a machine that has none", () => {
    const dir = tempSystemdDir();
    const res = run(dir);

    expect(res.status).toBe(0);
    for (const name of shippedUnits()) {
      expect(fs.readFileSync(path.join(dir, name), "utf8")).toBe(
        fs.readFileSync(path.join(UNIT_SRC, name), "utf8"),
      );
    }
    expect(res.systemctl).toContain("daemon-reload");
  });

  test("is a no-op, and reloads nothing, when the units are already current", () => {
    const dir = tempSystemdDir();
    expect(run(dir).status).toBe(0);

    const second = run(dir);
    expect(second.status).toBe(0);
    expect(second.stdout).toMatch(/units are current/);
    // The reload is the observable cost of a deploy touching systemd at all.
    // A deploy that changed no unit must not be distinguishable from one that
    // never looked — B138's complaint was the reverse, but the fix must not
    // start poking systemd on every unrelated deploy either.
    expect(second.systemctl).toEqual([]);
  });

  test("re-installs a unit that drifted on the machine, and names it", () => {
    const dir = tempSystemdDir();
    run(dir);

    const victim = "fernscout-backup.service";
    const shipped = fs.readFileSync(path.join(UNIT_SRC, victim), "utf8");
    fs.writeFileSync(path.join(dir, victim), shipped.replace(/^OnFailure=.*$/m, ""));

    const res = run(dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain(victim);
    expect(fs.readFileSync(path.join(dir, victim), "utf8")).toBe(shipped);
    expect(res.systemctl).toContain("daemon-reload");
  });

  /** The exact failure B138 was raised about, as a regression test: B64 shipped
   * `OnFailure=fernscout-alert@%n.service` and `deploy/fernscout-alert@.service`
   * together, and the server had neither. */
  test("installs the alert template a backup unit's OnFailure= depends on", () => {
    const dir = tempSystemdDir();
    run(dir);

    const backup = fs.readFileSync(path.join(dir, "fernscout-backup.service"), "utf8");
    expect(backup).toMatch(/^OnFailure=fernscout-alert@%n\.service$/m);
    expect(fs.existsSync(path.join(dir, "fernscout-alert@.service"))).toBe(true);
  });

  test("fails, naming the file, when it cannot write the unit directory", () => {
    const dir = tempSystemdDir();
    run(dir);

    const victim = "fernscout.service";
    fs.appendFileSync(path.join(dir, victim), "\n# drifted\n");
    fs.chmodSync(dir, 0o555);
    try {
      const res = run(dir);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain(victim);
      // Not merely "permission denied" — the operator is told what to run.
      expect(res.stderr).toMatch(/sudo cp/);
      expect(res.stderr).toMatch(/daemon-reload/);
    } finally {
      fs.chmodSync(dir, 0o755);
    }
  });

  test("re-arms a changed timer that is running, and leaves a stopped one alone", () => {
    const dir = tempSystemdDir();
    run(dir);
    const timer = "fernscout-backup.timer";
    const shipped = fs.readFileSync(path.join(UNIT_SRC, timer), "utf8");

    fs.writeFileSync(path.join(dir, timer), shipped.replace("03:20:00", "04:20:00"));
    const running = run(dir, { active: [timer] });
    expect(running.status).toBe(0);
    // daemon-reload alone re-reads the file but leaves an armed timer on the
    // old schedule, so a changed OnCalendar= would not take effect until boot.
    expect(running.systemctl).toContain(`restart ${timer}`);

    fs.writeFileSync(path.join(dir, timer), shipped.replace("03:20:00", "05:20:00"));
    const stopped = run(dir);
    expect(stopped.status).toBe(0);
    expect(stopped.systemctl.join("\n")).not.toContain(`restart ${timer}`);
  });

  test("never enables, disables or starts a unit — it only says which are off", () => {
    const dir = tempSystemdDir();
    const res = run(dir);

    const verbs = res.systemctl.filter((line) =>
      /^(enable|disable|start|stop|mask)\b/.test(line),
    );
    expect(verbs).toEqual([]);
    // fernscout-worker.service is the reason. Its own header says to enable it
    // "when there is something for it to do", and nothing enqueues work yet, so
    // a deploy that enabled every newly added unit would start a worker against
    // an empty queue. The operator is told instead.
    expect(res.stdout).toMatch(/fernscout-worker\.service is installed but not enabled/);
  });

  test("says nothing about a unit that is already enabled", () => {
    const dir = tempSystemdDir();
    const res = run(dir, { enabled: ["fernscout.service"] });
    expect(res.stdout).not.toMatch(/fernscout\.service is installed but not enabled/);
  });

  /** A template unit takes an instance and can never be enabled by bare name,
   * so suggesting `systemctl enable fernscout-alert@.service` would be advice
   * that fails when followed. */
  test("does not offer to enable a template unit", () => {
    const dir = tempSystemdDir();
    const res = run(dir);
    expect(res.stdout).not.toMatch(/fernscout-alert@\.service is installed but not enabled/);
  });

  /** deploy/Caddyfile sits in the same folder. Caddy has one shared config file
   * per host, so copying it over would delete any other site on the machine —
   * a different and more dangerous act than installing a unit. That drift is B66. */
  test("ignores deploy/Caddyfile", () => {
    const dir = tempSystemdDir();
    run(dir);
    expect(fs.existsSync(path.join(dir, "Caddyfile"))).toBe(false);
  });
});
