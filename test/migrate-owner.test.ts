import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseUserConfig } from "@/lib/config";

/**
 * scripts/migrate-owner.ts rewrites the pre-W37 config shape —
 * `travellers[]` plus `ownerEmail` — into the single `owner: { name,
 * nickname, email? }` the parser now requires. Exercised as a child process,
 * the same way a person or `scripts/deploy.sh` would run it, rather than by
 * importing its internals — it has none to import, by design.
 */

const ROOT = process.cwd();

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-migrate-owner-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeConfig(user: string, body: Record<string, unknown>) {
  fs.mkdirSync(path.join(dir, user), { recursive: true });
  fs.writeFileSync(path.join(dir, user, "config.json"), JSON.stringify(body, null, 2) + "\n");
}

function readConfig(user: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(dir, user, "config.json"), "utf8"));
}

/** Runs the script and returns stdout, stderr and the exit code — several of
 * the cases below deliberately exercise a non-zero one. */
function run(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("node", ["scripts/migrate-owner.ts", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, CONTENT_DIR: dir },
  });
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

const oldShape = (extra: Record<string, unknown> = {}) => ({
  title: "Alex's Journal",
  tagline: "wandering",
  ownerEmail: "alex@example.com",
  travellers: [
    { name: "Alex Berger", nickname: "Alex" },
    { name: "Robin Berger", nickname: "Robin" },
  ],
  startLocation: "Zurich",
  defaultLocale: "en",
  locales: ["en"],
  baseCurrency: "CHF",
  displayCurrencies: ["CHF"],
  units: "metric",
  features: {},
  ...extra,
});

describe("the happy path", () => {
  test("produces a config parseUserConfig accepts", () => {
    writeConfig("alex", oldShape());
    const result = run(["--user", "alex"]);
    expect(result.status).toBe(0);

    const config = readConfig("alex");
    expect(config.owner).toEqual({
      name: "Alex Berger",
      nickname: "Alex",
      email: "alex@example.com",
    });
    expect(config.travellers).toBeUndefined();
    expect(config.ownerEmail).toBeUndefined();

    // The assertion that actually matters: the file the script writes is one
    // the current parser takes, not merely one that looks plausible.
    expect(() => parseUserConfig("alex", config)).not.toThrow();
    expect(parseUserConfig("alex", config).owner).toEqual(config.owner);
  });

  test("preserves every other key", () => {
    writeConfig("alex", oldShape({ manualRates: { VND: 30500 } }));
    run(["--user", "alex"]);
    const config = readConfig("alex");
    expect(config.title).toBe("Alex's Journal");
    expect(config.tagline).toBe("wandering");
    expect(config.startLocation).toBe("Zurich");
    expect(config.manualRates).toEqual({ VND: 30500 });
  });

  test("no ownerEmail is fine — owner is written without one", () => {
    writeConfig("alex", { title: "T", travellers: [{ name: "Alex Berger" }] });
    const result = run(["--user", "alex"]);
    expect(result.status).toBe(0);
    const config = readConfig("alex");
    expect(config.owner).toEqual({ name: "Alex Berger", nickname: "Alex Berger" });
    expect(() => parseUserConfig("alex", config)).not.toThrow();
  });

  test("a nickname is never invented by splitting the name", () => {
    writeConfig("alex", { title: "T", travellers: [{ name: "Alex Middle Berger" }] });
    run(["--user", "alex"]);
    const config = readConfig("alex");
    expect((config.owner as { nickname: string }).nickname).toBe("Alex Middle Berger");
  });

  test("--dry-run prints the resulting owner and writes nothing", () => {
    writeConfig("alex", oldShape());
    const before = fs.readFileSync(path.join(dir, "alex", "config.json"), "utf8");
    const result = run(["--user", "alex", "--dry-run"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Alex Berger");
    expect(result.stdout).toContain("alex@example.com");
    expect(fs.readFileSync(path.join(dir, "alex", "config.json"), "utf8")).toBe(before);
  });
});

describe("a second traveller", () => {
  test("produces a warning naming them, and is not silently dropped or kept", () => {
    writeConfig("alex", oldShape());
    const result = run(["--user", "alex"]);
    expect(result.stderr).toContain("Robin Berger");
    expect(result.stderr).toMatch(/people:/);

    const config = readConfig("alex");
    // Not carried into owner...
    expect(config.owner).toEqual({
      name: "Alex Berger",
      nickname: "Alex",
      email: "alex@example.com",
    });
    // ...and not left behind anywhere else in the file either.
    expect(JSON.stringify(config)).not.toContain("Robin");
  });
});

describe("idempotency", () => {
  test("a config already carrying owner is reported as migrated and left untouched", () => {
    writeConfig("alex", {
      title: "T",
      owner: { name: "Alex Berger", nickname: "Alex", email: "alex@example.com" },
    });
    const before = fs.readFileSync(path.join(dir, "alex", "config.json"), "utf8");
    const result = run(["--user", "alex"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/already/i);
    expect(fs.readFileSync(path.join(dir, "alex", "config.json"), "utf8")).toBe(before);
  });

  test("running the script twice is safe", () => {
    writeConfig("alex", oldShape());
    run(["--user", "alex"]);
    const afterFirst = fs.readFileSync(path.join(dir, "alex", "config.json"), "utf8");
    const second = run(["--user", "alex"]);
    expect(second.status).toBe(0);
    expect(fs.readFileSync(path.join(dir, "alex", "config.json"), "utf8")).toBe(afterFirst);
  });
});

describe("no travellers to build an owner from", () => {
  test("an empty travellers[] is refused, not mangled", () => {
    writeConfig("alex", { title: "T", ownerEmail: "alex@example.com", travellers: [] });
    const before = fs.readFileSync(path.join(dir, "alex", "config.json"), "utf8");
    const result = run(["--user", "alex"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain("no travellers");
    expect(fs.readFileSync(path.join(dir, "alex", "config.json"), "utf8")).toBe(before);
  });

  test("no travellers key at all is refused, not mangled", () => {
    writeConfig("alex", { title: "T", ownerEmail: "alex@example.com" });
    const before = fs.readFileSync(path.join(dir, "alex", "config.json"), "utf8");
    const result = run(["--user", "alex"]);
    expect(result.status).not.toBe(0);
    expect(fs.readFileSync(path.join(dir, "alex", "config.json"), "utf8")).toBe(before);
  });
});

describe("the write path", () => {
  // The write is meant to be atomic: a temp file in the same directory,
  // then a rename over the original. Simulating an actual mid-write crash
  // (the process killed by OOM/SIGKILL partway through writing the temp
  // file) isn't practical from a vitest test — there's no hook that lands
  // between two bytes of a writeFileSync call. What *is* testable, and is
  // the case this suite covers, is a write that fails outright: the target
  // directory made unwritable so creating the temp file itself fails. That
  // exercises the same guarantee (original file byte-identical afterwards)
  // via a path that doesn't depend on timing.
  //
  // This does discriminate the two code paths, and was checked directly
  // rather than assumed: opening an *existing* file for writing needs write
  // permission on the file itself, not on its directory — only creating a
  // new directory entry (the temp file) needs that. So `chmod 555` on the
  // directory leaves the pre-fix, in-place `fs.writeFileSync(configPath, …)`
  // free to succeed; it is specifically the temp-file-then-rename sequence
  // this test's failure depends on. Reverting `writeConfigAtomic` to a plain
  // `fs.writeFileSync` and rerunning this test reproduces exactly that: the
  // script exits 0 and this assertion goes red.
  //
  // Skipped when running as root, where directory permission bits don't
  // block writes and the simulated failure wouldn't occur.
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

  test.skipIf(isRoot)(
    "a failed write leaves the original file byte-identical, and is reported as needing attention",
    () => {
      writeConfig("alex", oldShape());
      const userDir = path.join(dir, "alex");
      const before = fs.readFileSync(path.join(userDir, "config.json"), "utf8");

      fs.chmodSync(userDir, 0o555); // r-xr-xr-x: can't create a file inside it
      let result: { status: number; stdout: string; stderr: string };
      try {
        result = run(["--user", "alex"]);
      } finally {
        fs.chmodSync(userDir, 0o755); // restore, so afterEach's rmSync can clean up
      }

      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/failed to write config\.json/);
      expect(fs.readFileSync(path.join(userDir, "config.json"), "utf8")).toBe(before);

      // No orphaned temp file left behind either: the directory refused the
      // open() before any temp file could be created.
      const entries = fs.readdirSync(userDir);
      expect(entries).toEqual(["config.json"]);
    },
  );
});

describe("the CLI", () => {
  test("refuses to run with neither --user nor --all", () => {
    const result = run([]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/usage/i);
  });

  test("--all migrates every journal under the content root", () => {
    writeConfig("alex", oldShape());
    writeConfig("robin", { title: "R", travellers: [{ name: "Robin Berger" }] });
    const result = run(["--all"]);
    expect(result.status).toBe(0);
    expect(readConfig("alex").owner).toBeDefined();
    expect(readConfig("robin").owner).toBeDefined();
  });

  test("rejects a username shaped like a path", () => {
    const result = run(["--user", "../etc"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/usage/i);
  });
});
