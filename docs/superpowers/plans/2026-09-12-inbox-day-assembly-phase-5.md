# Inbox day-assembly Phase 5: GPS as an extractable location source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a date folder's "coordinates" question be answered from a
person's own GPS history when one exists, instead of only from a browser
button press or a WhatsApp pin — while leaving the hard, unconditional rule
that `gps/` is reachable from nothing under `app/` exactly as strict as it
already is.

**Architecture:** `lib/gps/api.ts` is the only thing an `app/` route may
reach for anything GPS-related (`test/gps-store.test.ts`'s import-graph
assertion enforces this today, for writes). This phase adds exactly one new
read-shaped capability to that same file — "does this date have fixes at
all" (a boolean) and, once a person agrees to use them, "the one coordinate
for this date" (used only to write directly into `day.json`, never returned
in a response body or a proposal's visible text). Nothing under
`lib/dayMissing.ts`/`lib/helper/tools/**` imports `lib/gps/store.ts` or
`lib/gps/enrich.ts` directly — everything routes through the new
`lib/gps/api.ts` functions, the same indirection every existing GPS-touching
route already uses.

**Tech Stack:** `lib/gps/store.ts`'s existing `readRange(username, from, to)`
(ms-epoch bounds, returns `Fix[]`), `lib/gps/api.ts` (the existing
write-only surface this phase extends).

**Spec:** `docs/superpowers/specs/2026-09-12-inbox-day-assembly-design.md`
(Phase 5 section — "GPS as an extractable location source")

## Global Constraints — read these before writing any code

- **`gps/` is the most sensitive folder in this repository, and the rule
  carries over completely unchanged.** Nothing under `app/` may import
  `lib/gps/store.ts` or `lib/gps/enrich.ts`, directly or transitively.
  `test/gps-store.test.ts`'s existing "nothing under app/ imports the store
  or the derivation" test is the check that would catch a violation, and
  this phase adds **no exception** to it.
- **A boolean, never a coordinate, ever reaches a route's response body, a
  proposal's visible text, or a model's own context as prose.** `hasTrack`
  in `lib/gps/api.ts` is the existing precedent — it "says if, never where."
  This phase's new "does this date have fixes" check must have the same
  shape. The one coordinate this phase ever produces is written **directly**
  into `day.json`'s `location` field by server-side code that never returns
  it to the caller in the same response — the write and the read of that
  written value are two separate, later requests, exactly like every other
  `day.json` field.
- **The person agrees before anything is written.** This is a proposal
  (`kind: "write"`, `renders: "confirm"`) like every other tool in this
  project — "there's a GPS fix for this date, use it?" is the question, and
  nothing is written until the press.
- **One git command per shell call, and clone `node_modules` with `cp -Rc`**
  — this repository's own worktree rules (AGENTS.md), unchanged by this plan.

---

### Task 1: `lib/gps/api.ts` gains a presence check and an extraction

**Files:**
- Modify: `lib/gps/api.ts`
- Test: `test/gps-api.test.ts` (create if no direct test of this file's
  exports exists yet — check first with `grep -rl "lib/gps/api" test/`)

**Interfaces:**
- Consumes: `readRange` (existing, `lib/gps/store.ts` — this file already
  imports from `./store`, so this is not a new import boundary).
- Produces: `hasFixesForDate(username: string, date: string): boolean`,
  `extractLocationForDate(username: string, date: string): { lat: number; lon: number } | null`.
  Task 2 is the only caller of either.

- [ ] **Step 1: Read `lib/gps/api.ts` in full**

Already read once during this plan's research — re-read fresh before
editing, since it is the one file this whole phase must not get wrong. Note
`hasTrack`'s exact shape (`readTrack(username, tripId) !== undefined`) as
the precedent to match: presence only, nothing about where.

- [ ] **Step 2: Write the failing tests**

Create `test/gps-api.test.ts`. Reuse `test/gps-store.test.ts`'s fixture
setup (the `at(minutes, lat, lon)` helper, `CONTENT_DIR` temp dir pattern)
rather than writing a third copy.

```ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendFixes } from "@/lib/gps/store";
import { hasFixesForDate, extractLocationForDate } from "@/lib/gps/api";

const USER = "ana";
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-gps-api-"));
  process.env.CONTENT_DIR = dir;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.CONTENT_DIR;
});

describe("hasFixesForDate", () => {
  test("true for a date with at least one fix", () => {
    appendFixes(USER, [{ t: Date.UTC(2026, 4, 4, 12, 0, 0), lat: 46.5, lon: 7.9 }]);
    expect(hasFixesForDate(USER, "2026-05-04")).toBe(true);
  });

  test("false for a date with none, and for a journal with no history", () => {
    expect(hasFixesForDate(USER, "2026-05-04")).toBe(false);
    expect(hasFixesForDate("nobody", "2026-05-04")).toBe(false);
  });
});

describe("extractLocationForDate", () => {
  test("the midpoint fix of the day, when several exist", () => {
    appendFixes(USER, [
      { t: Date.UTC(2026, 4, 4, 6, 0, 0), lat: 46.0, lon: 7.0 },
      { t: Date.UTC(2026, 4, 4, 12, 0, 0), lat: 46.5, lon: 7.5 },
      { t: Date.UTC(2026, 4, 4, 18, 0, 0), lat: 47.0, lon: 8.0 },
    ]);
    const loc = extractLocationForDate(USER, "2026-05-04");
    expect(loc?.lat).toBeCloseTo(46.5, 1);
    expect(loc?.lon).toBeCloseTo(7.5, 1);
  });

  test("null for a date with no fixes", () => {
    expect(extractLocationForDate(USER, "2026-05-04")).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/gps-api.test.ts`
Expected: FAIL — neither function exists.

- [ ] **Step 4: Add the two functions to `lib/gps/api.ts`**

Add, after the existing `hasTrack`:

```ts
/** Whether this date has any position at all — says if, never where, the
 *  same shape `hasTrack` already uses for a trip's line. Phase 5's own
 *  presence check, so a proposal can ask "use your GPS for this day?"
 *  without the coordinate ever having to travel anywhere to answer it. */
export function hasFixesForDate(username: string, date: string): boolean {
  const from = Date.parse(`${date}T00:00:00Z`);
  const to = Date.parse(`${date}T23:59:59.999Z`);
  return readRange(username, from, to).length > 0;
}

/**
 * The one coordinate for this date, once a person has agreed to use it.
 *
 * **Never returned by a route, never placed in a proposal's visible text or
 * a model's context.** The only legitimate caller is server-side code that
 * writes the result straight into `day.json`'s `location` field and returns
 * nothing about it in the same response — a later, separate read of
 * `day.json` is how anything downstream ever sees this value, exactly as
 * every other `day.json` field already works.
 *
 * The middle fix of the day, by time — not an average of lat/lon (which
 * could land somewhere between two real places that were never visited) and
 * not the first fix (which could be a stray reading from the previous day's
 * last movement, given `readRange`'s bounds are a calendar day in UTC, not
 * the journal's own timezone — a limitation worth a comment rather than a
 * fix here, since Phase 2/3's `day.json` also has no per-day timezone
 * concept yet).
 */
export function extractLocationForDate(username: string, date: string): { lat: number; lon: number } | null {
  const from = Date.parse(`${date}T00:00:00Z`);
  const to = Date.parse(`${date}T23:59:59.999Z`);
  const fixes = readRange(username, from, to);
  if (fixes.length === 0) return null;
  const middle = fixes[Math.floor(fixes.length / 2)];
  return { lat: middle.lat, lon: middle.lon };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/gps-api.test.ts`
Expected: PASS

- [ ] **Step 6: Run `test/gps-store.test.ts` to confirm the import-graph guard still holds**

Run: `npx vitest run test/gps-store.test.ts`
Expected: PASS — this task added no new import of `./store`/`./enrich` from
anywhere under `app/`; the guard should be unaffected. Confirming it here,
explicitly, before moving to Task 2 which is where a mistake could actually
introduce one.

- [ ] **Step 7: Commit**

```bash
git add lib/gps/api.ts test/gps-api.test.ts
git commit -m "lib/gps/api.ts: a date's presence and its one extractable coordinate, never returned as itself (SDD plan: inbox day-assembly Phase 5, Task 1)"
```

---

### Task 2: Offer the extraction as a proposal, from `assemble_day`

**Files:**
- Modify: `lib/dayMissing.ts` (Phase 3) — add a `"gpsAvailable"` signal
  `assemble_day` can act on
- Modify: `lib/helper/tools/areas/*.ts` — wherever `assemble_day` lives
  (Phase 3, Task 2)
- Test: extend `test/day-missing.test.ts` and `test/helper-tool-assemble.test.ts`

**Interfaces:**
- Consumes: `hasFixesForDate`, `extractLocationForDate` (Task 1).

- [ ] **Step 1: Read `assemble_day`'s current implementation in full**

This is Phase 3's own tool — read it fresh (it will exist by the time this
phase is built, since Phase 5 depends on Phase 2, and Phase 3 is expected to
ship before Phase 5 per the spec's stated build order) before adding to it.

- [ ] **Step 2: Write the failing test**

Add to `test/day-missing.test.ts`:

```ts
test("a date with GPS history but no location item yet is not asked to decline coordinates — it is offered the extraction instead", () => {
  journal();
  appendFixes("u", [{ t: Date.UTC(2026, 4, 4, 12, 0, 0), lat: 46.5, lon: 7.5 }]);
  const missing = missingForDayFolder("u", "2026-05-04", ALL_TRACKED);
  const coordinates = missing.find((m) => m.field === "coordinates");
  // The exact shape this test asserts depends on how Task 3 decides to
  // surface "GPS is available" through DayFolderMissing/the proposal —
  // write this concretely once that decision is made (see Step 3 below),
  // rather than guessing the shape here.
});
```

This step is deliberately incomplete for the same reason Phase 3's Task 2
Step 2 was: the concrete shape depends on a design decision this task makes
in Step 3. Write the real assertion once Step 3 is implemented, TDD-style.

- [ ] **Step 3: Decide and implement how "GPS available" reaches the proposal**

Two shapes are worth naming explicitly, and this task should pick one and
say why in its commit message rather than leaving it ambiguous:

**Option A — a third field on `DayFolderMissing`'s `coordinates` entry.**
`missingForDayFolder` checks `hasFixesForDate` alongside its existing
`readiness.location !== undefined` check; when coordinates are missing *and*
GPS has something, the `Missing` entry for `"coordinates"` carries an extra
flag (`gpsAvailable: true`) `assemble_day`'s `fieldFor` helper turns into a
third option ("use my GPS for this day") alongside the existing
`unknown`/`none`.

**Option B — a separate proposal step.** `assemble_day`'s `propose` checks
`hasFixesForDate` itself (not through `missingForDayFolder`) and, when true
and no location exists yet, returns a distinct sentence/field set offering
only the GPS choice, before falling through to the ordinary missing-fields
batch.

**Recommendation: Option A.** It keeps the "ask everything missing, once, in
one batch" shape Phase 3 built rather than adding a second conversational
branch, and it is a small, additive change to `DayFolderMissing`'s
`coordinates` variant rather than a new code path in `assemble_day` itself.
Implement Option A unless something found during Phase 3's own
implementation makes it a poor fit — if so, record why in the ledger (if
using the SDD process) and implement Option B instead, explaining the
reasoning in the commit message either way.

For Option A, in `lib/dayMissing.ts`:

```ts
import { hasFixesForDate } from "./gps/api";

// Inside missingForDayFolder, extend the DayFolderMissing union:
export type DayFolderMissing =
  | { field: Track; why: string; send: string; decline: string; unknown: string; gpsAvailable?: boolean }
  | { field: "weather"; why: string }
  | { field: "caption"; why: string; photoId: string; filename: string };

// Where `registered` (from missingFrom) is built, annotate the coordinates
// entry if present:
const gpsAvailable = readiness.location === undefined && hasFixesForDate(username, date);
const out: DayFolderMissing[] = registered.map((m) =>
  m.field === "coordinates" && gpsAvailable ? { ...m, gpsAvailable: true } : m,
);
```

Then in `assemble_day`'s `fieldFor` helper (`lib/helper/tools/areas/*.ts`),
add a third option when `m.field === "coordinates" && m.gpsAvailable`:

```ts
{ value: "gps", label: say("agent.answerUseGps") }
```

- [ ] **Step 4: The confirm route applies the extraction when chosen**

In `app/api/helper/[user]/assemble-day/route.ts` (Phase 3, Task 3), before
building `DraftInput`, check whether the incoming body's `coordinates`
answer is `"gps"` — if so, call `extractLocationForDate` and use its result
for `lat`/`lng` instead of (or in addition to) `readiness.location`. This is
the one place the actual coordinate is read out of `lib/gps/api.ts` and
immediately written into the new entry — never echoed back in the response
beyond what `POST .../day` already returns for `lat`/`lng` on an ordinary
day (which is nothing — the response is `{ ok, trip, slug }`, confirmed by
reading that route in Phase 3's research).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/day-missing.test.ts test/helper-tool-assemble.test.ts test/assemble-day-route.test.ts`
Expected: PASS

- [ ] **Step 6: Re-run the import-graph guard once more**

Run: `npx vitest run test/gps-store.test.ts`
Expected: PASS. This is the check that would catch this task's most likely
mistake — do not skip it because Task 1 already passed it once; this task
adds new call sites in `lib/dayMissing.ts` and the route, and the guard only
protects what it actually scans (everything under `app/`), so confirm the
route file itself imports `lib/gps/api.ts` and nothing from `./store`/`./enrich`
directly.

- [ ] **Step 7: Commit**

```bash
git add lib/dayMissing.ts lib/helper/tools/areas/ app/api/helper/\[user\]/assemble-day/ test/
git commit -m "Offer a date's GPS history as a third answer to 'where', alongside declining or saying so, never shown as a trail (SDD plan: inbox day-assembly Phase 5, Task 2)"
```

---

## Final check

- [ ] Run `npm run verify` in full.
- [ ] Run `npx vitest run test/gps-store.test.ts` one more time, standalone,
  as the final gate before merge — this is the one test in the whole
  repository whose failure means this phase did something AGENTS.md calls
  the most sensitive rule in the project. Do not merge if it fails, and do
  not investigate a failure by weakening the test.
- [ ] `test-in-a-browser`: with a test journal that has some `gps/` history
  (import a small JSON Lines fixture via the existing `POST /api/v1/<user>/import`
  kind `gps`, locally), open `/agent`, assemble a day whose date falls in
  that history, and confirm the GPS option appears and — once pressed — the
  day gets a real location with no coordinate or trail visible anywhere in
  the conversation transcript itself.

## What this phase deliberately leaves alone

- **No day-to-day trip line changes.** `track.json`'s own derivation
  (`deriveTripTrack`, `npm run gps -- enrich`) is unrelated to this phase and
  untouched — this phase is about one day's own `location`, not a trip's
  drawn route.
- **No timezone handling for the day boundary.** `extractLocationForDate`'s
  `[date T00:00:00Z, date T23:59:59.999Z]` window is UTC, matching
  `readRange`'s own existing convention (`monthOf` in `lib/gps/store.ts` is
  UTC too) — a day folder near midnight in a traveller's actual timezone
  could pull a fix from the wrong side of the boundary. This is a known,
  small imprecision inherited from the store's own existing UTC convention,
  not a new problem this phase introduces; worth a backlog capture if a
  person notices it in practice; not a acceptance blocker for this plan.
