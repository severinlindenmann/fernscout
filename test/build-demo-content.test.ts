import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";

/**
 * B556 — re-running the demo builder must not silently delete the fields the
 * committed journal carries.
 *
 * `content/example/` is committed and has drifted ahead of what
 * `scripts/build-demo-content.mjs` knows how to write — `weatherData:` from
 * B325's archive lookup, `transportMode:`/`transportFrom:`/`transportTo:`,
 * and hand-edited prose. A bare re-run rewrote 42 files with 161 deletions
 * against 30 insertions and exited 0, printing only "Wrote 5 trips, 38
 * entries" — the loss was visible in `git diff` and nowhere else.
 *
 * The script is now a one-off seeder: it refuses to touch a demo journal
 * that already exists unless told `--force`. This checkout's own
 * `content/example/` is the fixture — the script hardcodes its target
 * relative to its own path rather than reading `$CONTENT_DIR`, so there is
 * no clean-checkout version of it to point at instead, and the whole point
 * is that the *real* committed journal is what must survive an accidental
 * run.
 */

const SCRIPT = path.join(process.cwd(), "scripts", "build-demo-content.mjs");
const ALPS_TRIP = path.join(process.cwd(), "content", "example", "trips", "alps-2024", "trip.md");

function run(args: string[]): { status: number; stderr: string; stdout: string } {
  try {
    const stdout = execFileSync("node", [SCRIPT, ...args], { encoding: "utf8" });
    return { status: 0, stderr: "", stdout };
  } catch (err) {
    const e = err as { status: number; stderr: Buffer; stdout: Buffer };
    return { status: e.status, stderr: e.stderr.toString(), stdout: e.stdout.toString() };
  }
}

describe("re-running the demo builder against a journal that already exists", () => {
  test("refuses without --force, and touches nothing on disk", () => {
    const before = fs.readFileSync(ALPS_TRIP, "utf8");
    const result = run([]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("already has a demo journal");
    expect(result.stderr).toContain("--force");
    expect(fs.readFileSync(ALPS_TRIP, "utf8")).toBe(before);
  });

  test("--media alone is still a refusal — force is the only door past it", () => {
    const before = fs.readFileSync(ALPS_TRIP, "utf8");
    const result = run(["--media"]);
    expect(result.status).not.toBe(0);
    expect(fs.readFileSync(ALPS_TRIP, "utf8")).toBe(before);
  });
});
