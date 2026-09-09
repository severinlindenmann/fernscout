import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";

/**
 * B541 — `build-demo-content.mjs` had drifted from `content/example/`: a bare
 * re-run silently deleted `travellers:` blocks and a transport leg, printed
 * "Wrote 5 trips, 38 entries", and exited 0. This regenerates into a scratch
 * directory (via `--out`, which exists for exactly this) and diffs the result
 * against the committed journal, so the next field somebody adds by hand
 * without teaching the generator fails a test instead of waiting for the next
 * `git diff --stat content/` to notice.
 *
 * Three things are allowed to differ, and only these:
 *
 * - Any line beginning `weatherData:` — filled by `npm run weather:update`
 *   against a live archive (B325), never by this generator. Excluded by
 *   design; see the module comment at the top of the script.
 * - Any line beginning `timezone:` — filled by `npm run timezone:update` from
 *   the coordinates the day already carries (B1090), never by this generator.
 *   The same shape as `weatherData` and excluded for the same reason: it is
 *   derived from the day rather than authored with it, so a sweep owns it and
 *   the generator does not. A day the generator names a zone for itself still
 *   has to match — this only forgives a zone that was filled in afterwards.
 * - `content/example/config.json` — hand-maintained, never written by this
 *   script.
 *
 * **The comparison is the whole file, in order** — B736. It used to be a set
 * of lines, which was the right shape while the generator had known gaps: it
 * could say "this line is missing" without failing on the same content in a
 * different order. That is also what it could not see. B736 item 5 was
 * `travellers:` sitting before `visibility:` in one trip and after
 * `costsVisibility:` in the other three — every line present, every line
 * matching, and a file the generator would rewrite on sight. With the gap
 * lists empty there is nothing left to be lenient for, so the assertion is
 * now the ticket's own acceptance: `node scripts/build-demo-content.mjs
 * --force` leaves `git status content/` empty.
 */

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, "scripts", "build-demo-content.mjs");
const COMMITTED = path.join(ROOT, "content", "example");

function listMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "media" || entry.name === "originals") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMarkdown(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/** The file as the generator could have written it: everything but the
 *  measurements, which come from an archive and not from this script. */
function comparable(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("weatherData:") && !line.startsWith("timezone:"))
    .join("\n");
}

let scratch: string | undefined;

afterEach(() => {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

describe("build-demo-content.mjs regenerates content/example/ with no drift", () => {
  test("every trips/ file is reproduced exactly, apart from weatherData", () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-demo-regen-"));
    execFileSync("node", [SCRIPT, `--out=${scratch}`], { encoding: "utf8" });

    const committedTrips = path.join(COMMITTED, "trips");
    const generatedTrips = path.join(scratch, "trips");
    const committedFiles = listMarkdown(committedTrips);

    const differing: string[] = [];
    const missing: string[] = [];

    for (const committedFile of committedFiles) {
      const rel = path.relative(committedTrips, committedFile);
      const generatedFile = path.join(generatedTrips, rel);
      if (!fs.existsSync(generatedFile)) {
        missing.push(rel);
        continue;
      }
      if (comparable(generatedFile) !== comparable(committedFile)) differing.push(rel);
    }

    // Every generated file should exist in the committed journal too — a
    // file the generator writes and content/example/ does not carry would
    // mean TRIPS grew a day nobody committed.
    const generatedFiles = listMarkdown(generatedTrips).map((f) => path.relative(generatedTrips, f));
    const extra = generatedFiles.filter(
      (f) => !committedFiles.some((c) => path.relative(committedTrips, c) === f),
    );

    expect(differing, "the generator no longer reproduces these files").toEqual([]);
    expect(missing, "committed days the generator does not write — add them to TRIPS").toEqual([]);
    expect(extra, "the generator wrote a file content/example/ doesn't have").toEqual([]);
  });
});
