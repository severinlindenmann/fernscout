import { afterEach, describe, expect, test } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * B1084 and B1085 — the two halves of what the nightly run does now.
 *
 * B1084: the ECB table used to be committed at `site/rates/ecb.json` and to
 * arrive by `git pull`, so the number only moved when a person happened to run
 * a command and deploy the result — twelve days stale on the live instance
 * when it was measured. It is now instance state under `DATA_DIR`, refreshed
 * off the back of the nightly backup, and **not in git at all**. Two things
 * about that are worth a test rather than a comment: that a refresh cannot
 * write into the checkout, and that an instance with `costs` off neither
 * fetches nor keeps a table.
 *
 * B1085: the good night stopped being mailed, so `OnSuccess=` had to go while
 * `OnFailure=` stayed. Both are asserted, because deleting the wrong one is
 * silent — a backup that fails and tells nobody is the fault the whole
 * mechanism exists to prevent (B64), and it looks exactly like success.
 */

const ROOT = path.join(import.meta.dirname, "..");
const run = promisify(execFile);

/** One day's ECB daily table, in the shape the real document uses. */
const DAILY_XML =
  '<?xml version="1.0"?><gesmes:Envelope><Cube><Cube time="2026-09-09">' +
  '<Cube currency="CHF" rate="0.9364"/><Cube currency="USD" rate="1.1643"/>' +
  "</Cube></Cube></gesmes:Envelope>";

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A DATA_DIR with a server config in it, `costs` set as asked. */
function instance(costs: boolean): { dataDir: string; configPath: string } {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-rates-"));
  made.push(dataDir);
  const configPath = path.join(dataDir, "config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      site: { name: "Testbed", url: "https://example.test", defaultUser: "example" },
      features: { costs: { enabled: costs } },
    }),
  );
  return { dataDir, configPath };
}

/** Runs the refresh against a fixture served from this process. */
async function refresh(
  { dataDir, configPath }: { dataDir: string; configPath: string },
  args: string[] = [],
): Promise<string> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/xml" });
    res.end(DAILY_XML);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    // `execFile`, not the sync form: the fixture is served from this very
    // process, and blocking the event loop means the child waits for a reply
    // nobody can send.
    const { stdout } = await run(
      "npx",
      ["tsx", "--conditions=react-server", "scripts/rates-refresh.mts", ...args],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          ECB_RATES_URL: `http://127.0.0.1:${port}/`,
          DATA_DIR: dataDir,
          FERNSCOUT_CONFIG: configPath,
        },
      },
    );
    return stdout;
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

describe("the nightly rates refresh", () => {
  test("writes under DATA_DIR and never into the checkout", async () => {
    const inst = instance(true);
    await refresh(inst);

    const written = JSON.parse(
      fs.readFileSync(path.join(inst.dataDir, "rates", "ecb.json"), "utf8"),
    );
    expect(written.date).toBe("2026-09-09");
    expect(written.rates.CHF).toBe(0.9364);

    // The assertion that matters: nothing appeared in the checkout. If this
    // ever fails, a nightly run dirties /srv/fernscout and the next deploy's
    // `git pull` stops.
    expect(fs.existsSync(path.join(ROOT, "site", "rates"))).toBe(false);
  }, 60_000);

  test("does nothing at all when costs is switched off", async () => {
    const inst = instance(false);
    const out = await refresh(inst);

    // No file, and it said so rather than exiting quietly — a nightly job that
    // prints nothing cannot be told apart from one that is not running.
    expect(fs.existsSync(path.join(inst.dataDir, "rates", "ecb.json"))).toBe(false);
    expect(out).toContain("costs is switched off");
  }, 60_000);

  test("a dry run names the path it would write and writes nothing", async () => {
    const inst = instance(true);
    const out = await refresh(inst, ["--dry-run"]);

    expect(out).toContain(path.join(inst.dataDir, "rates", "ecb.json"));
    expect(fs.existsSync(path.join(inst.dataDir, "rates", "ecb.json"))).toBe(false);
  }, 60_000);

  test("the table is not tracked by git", () => {
    // Belt and braces against the file coming back: it was committed for most
    // of this project's life, so `npm run rates:update` on a laptop putting it
    // back under version control is the likely regression, not an exotic one.
    const tracked = execFileSync("git", ["-C", ROOT, "ls-files", "site/rates"], {
      encoding: "utf8",
    });
    expect(tracked.trim()).toBe("");
    expect(fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8")).toMatch(/^site\/rates\/$/m);
  });
});

describe("the nightly backup unit", () => {
  const unit = fs.readFileSync(path.join(ROOT, "deploy", "fernscout-backup.service"), "utf8");

  test("still tells somebody when a run fails", () => {
    // Directives only — the comment block above them discusses both words at
    // length, so a naive `toContain` would pass on the prose alone.
    const directives = unit.split("\n").filter((l) => /^On(Failure|Success)=/.test(l));
    expect(directives).toEqual(["OnFailure=fernscout-alert@%n.service"]);
  });

  test("no longer mails on a run that worked", () => {
    expect(unit).not.toMatch(/^OnSuccess=/m);
  });

  test("the success stamp the admin page reads is still written by the backup itself", () => {
    // B1085's one real risk: if the stamp ever moves into scripts/alert.sh,
    // dropping the success handler silently blanks the panel that replaced the
    // mail. It is written on the last line of a successful run today.
    const script = fs.readFileSync(path.join(ROOT, "scripts", "backup.sh"), "utf8");
    expect(script).toContain('> "$DATA_DIR/.backup-last-success"');
  });

  test("the rates refresh cannot fail the backup", () => {
    const script = fs.readFileSync(path.join(ROOT, "scripts", "backup.sh"), "utf8");
    const step = script.slice(script.indexOf("# --- 0."), script.indexOf("# --- 1."));
    expect(step).toContain("npm run --silent rates:update");
    // Guarded by `if`, so a non-zero exit is a logged WARNING and not the end
    // of the run. The backup is the half that matters.
    expect(step).toMatch(/WARNING: refreshing the reference rates failed/);
  });
});
