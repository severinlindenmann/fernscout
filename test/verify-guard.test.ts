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
    const stdout = execFileSync("node", [path.join(process.cwd(), "scripts/verify.mjs")], {
      cwd: dir,
      env: { ...process.env, ...env },
      stdio: "pipe",
    });
    return { status: 0, stdout: stdout.toString("utf8"), stderr: "" };
  } catch (err) {
    const e = err as { status: number | null; stdout: Buffer; stderr: Buffer };
    return { status: e.status, stdout: e.stdout.toString("utf8"), stderr: e.stderr.toString("utf8") };
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

/**
 * B1973: `next dev` writes `.next/dev/types/validator.ts` with an import per
 * route. Delete a route and the file keeps the stale import, so `next
 * build`'s own type-check fails with a TS2307 naming a path that never
 * existed on this branch — read as a real dangling reference rather than a
 * leftover cache. verify.mjs now clears it, unconditionally, before build.
 */
describe("verify.mjs clears stale .next/dev/types before building", () => {
  test("removes it and says so, then proceeds past the build step", () => {
    fs.mkdirSync(path.join(dir, "node_modules", "next"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "node_modules", "next", "package.json"),
      JSON.stringify({ version: "0.0.0-test" }),
    );
    const staleTypes = path.join(dir, ".next", "dev", "types");
    fs.mkdirSync(staleTypes, { recursive: true });
    fs.writeFileSync(
      path.join(staleTypes, "validator.ts"),
      'import x from "../../../app/deleted-route/page.js";\n',
    );

    const { stdout, stderr } = run({ CI: "true", VERIFY_WILL_WAIT: undefined });
    expect(stdout + stderr).toMatch(/Cleared stale \.next\/dev\/types/);
    expect(fs.existsSync(staleTypes)).toBe(false);
  });
});
