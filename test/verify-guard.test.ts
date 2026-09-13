import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

/**
 * B1665-shaped: the guard in scripts/verify.mjs that refuses an unattended
 * run rather than let it be backgrounded and abandoned. Run the script as a
 * real subprocess (not imported) since the whole point is process-level
 * state — `stdout.isTTY` and env vars — that only a spawn exercises.
 *
 * The script's *next* check (no node_modules) also exits 1, so an empty
 * scratch directory is enough to reach the guard and stop there: nothing
 * here needs a real build, and neither check can be reached without passing
 * the other first.
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-guard-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function run(env: Record<string, string | undefined>) {
  try {
    execFileSync("node", [path.join(process.cwd(), "scripts/verify.mjs")], {
      cwd: dir,
      env: { ...process.env, ...env },
      stdio: "pipe",
    });
    return { status: 0, stderr: "" };
  } catch (err) {
    const e = err as { status: number | null; stderr: Buffer };
    return { status: e.status, stderr: e.stderr.toString("utf8") };
  }
}

describe("verify.mjs unattended-run guard", () => {
  test("refuses when detached from a terminal, with CI and the escape hatch unset", () => {
    const { status, stderr } = run({ CI: undefined, VERIFY_WILL_WAIT: undefined });
    expect(status).toBe(1);
    expect(stderr).toMatch(/no terminal is attached/);
    expect(stderr).toMatch(/timeout: 900000/);
    expect(stderr).toMatch(/VERIFY_WILL_WAIT/);
  });

  test("CI unblocks it — reaches the next check instead", () => {
    const { stderr } = run({ CI: "true", VERIFY_WILL_WAIT: undefined });
    expect(stderr).not.toMatch(/no terminal is attached/);
    expect(stderr).toMatch(/No node_modules here/);
  });

  test("VERIFY_WILL_WAIT unblocks it — reaches the next check instead", () => {
    const { stderr } = run({ CI: undefined, VERIFY_WILL_WAIT: "1" });
    expect(stderr).not.toMatch(/no terminal is attached/);
    expect(stderr).toMatch(/No node_modules here/);
  });
});
