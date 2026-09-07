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
 * Two things are allowed to differ, and only these:
 *
 * - Any line containing `weatherData:` — filled by `npm run weather:update`
 *   against a live archive (B325), never by this generator. Excluded by
 *   design; see the module comment at the top of the script.
 * - `content/example/config.json` — hand-maintained, never written by this
 *   script.
 *
 * Everything else the generator has not caught up to yet is tracked as B736
 * rather than silenced here: `KNOWN_GAPS` below names every remaining
 * differing line, one entry per gap, so this test still fails the moment a
 * *new*, undocumented difference appears, while not re-litigating what B736
 * already knows about. Closing an item in B736 means deleting its line from
 * `KNOWN_GAPS`, not touching this test.
 */

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, "scripts", "build-demo-content.mjs");
const COMMITTED = path.join(ROOT, "content", "example");

// One entry per still-open line from B736. `file` is relative to
// `content/example/trips/`; `line` is matched by substring against the
// *committed* file's line (the one the generator does not (yet) produce).
const KNOWN_GAPS: { file: string; line: string }[] = [
  // B736 item 1 — travelScene has no generator field yet.
  { file: "asia-2023/entries/2023-01-24-night-train-north.md", line: 'travelScene: "quick"' },
  { file: "asia-2023/entries/2023-04-18-hue-to-hoi-an.md", line: 'travelScene: "skip"' },
  // B736 item 2 — per-item visibility (B596) has no generator field yet.
  { file: "usa-2026/entries/2026-06-19-utah-red-country.md", line: "visibility: guest" },
  { file: "usa-2026/entries/2026-07-28-sierra-smoke.md", line: "visibility: guest" },
  { file: "usa-2026/entries/2026-08-24-oregon-coast-evening.md", line: "visibility: guest" },
  { file: "usa-2026/entries/2026-08-24-oregon-coast.md", line: "visibility: private" },
  // B736 item 3 — captions the generator's day.captions doesn't carry.
  { file: "asia-2023/entries/2023-01-09-bangkok-first-morning.md", line: "The camera, put down for five minutes" },
  { file: "parks-2025/entries/2025-09-06-zion-narrows.md", line: "The water going over, and the spray coming straight back up" },
  { file: "parks-2025/entries/2025-09-06-zion-narrows.md", line: "Steps down into the fog, and nothing at the bottom of them" },
  { file: "usa-2026/entries/2026-08-24-oregon-coast.md", line: "One leaf still holding the rain" },
  { file: "usa-2026/entries/2026-08-24-oregon-coast.md", line: "The beach at low tide, and one person on the whole of it" },
  // B736 item 5 — usa-2026's travellers: sits before visibility: in the
  // committed file; the generator always places it after costsVisibility:,
  // matching the other three trips that carry one.
  { file: "usa-2026/trip.md", line: "visibility: public" },
  { file: "usa-2026/trip.md", line: "costsVisibility: public" },
];

// B736 item 4 — six entries written by hand, entirely absent from TRIPS.
const KNOWN_MISSING_FILES = [
  "asia-2023/entries/2023-01-08-leaving-zurich.md",
  "asia-2023/entries/2023-02-10-chiang-rai-by-car.md",
  "asia-2023/entries/2023-02-20-the-slow-bus-to-the-border.md",
  "asia-2023/entries/2023-03-05-up-the-hill-on-foot.md",
  "asia-2023/entries/2023-04-25-over-to-da-nang.md",
  "usa-2026/entries/2026-06-03-denver-money.md",
];

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

let scratch: string | undefined;

afterEach(() => {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

describe("build-demo-content.mjs regenerates content/example/ with no undocumented drift", () => {
  test("every trips/ file matches, apart from weatherData and B736's known gaps", () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-demo-regen-"));
    execFileSync("node", [SCRIPT, `--out=${scratch}`], { encoding: "utf8" });

    const committedTrips = path.join(COMMITTED, "trips");
    const generatedTrips = path.join(scratch, "trips");
    const committedFiles = listMarkdown(committedTrips);

    const unexpectedDiffs: string[] = [];
    const unexpectedlyMissing: string[] = [];

    for (const committedFile of committedFiles) {
      const rel = path.relative(committedTrips, committedFile);
      const generatedFile = path.join(generatedTrips, rel);
      if (!fs.existsSync(generatedFile)) {
        if (!KNOWN_MISSING_FILES.includes(rel)) unexpectedlyMissing.push(rel);
        continue;
      }
      const committedLines = fs.readFileSync(committedFile, "utf8").split("\n");
      const generatedLines = new Set(fs.readFileSync(generatedFile, "utf8").split("\n"));
      for (const line of committedLines) {
        if (generatedLines.has(line)) continue;
        if (line.includes("weatherData:")) continue;
        const allowed = KNOWN_GAPS.some((gap) => gap.file === rel && line.includes(gap.line));
        if (!allowed) unexpectedDiffs.push(`${rel}: ${line.trim()}`);
      }
    }

    // Every generated file should exist in the committed journal too — a
    // file the generator writes and content/example/ does not carry would
    // mean TRIPS grew a day nobody committed.
    const generatedFiles = listMarkdown(generatedTrips).map((f) => path.relative(generatedTrips, f));
    const unexpectedlyNew = generatedFiles.filter(
      (f) => !committedFiles.some((c) => path.relative(committedTrips, c) === f),
    );

    expect(unexpectedDiffs, "undocumented drift — see B736, or fix and remove from KNOWN_GAPS").toEqual([]);
    expect(unexpectedlyMissing, "a file B736 doesn't know is missing").toEqual([]);
    expect(unexpectedlyNew, "the generator wrote a file content/example/ doesn't have").toEqual([]);
  });
});
