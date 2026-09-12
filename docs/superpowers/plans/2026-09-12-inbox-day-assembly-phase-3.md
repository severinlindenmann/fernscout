# Inbox day-assembly Phase 3: the conversation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new tool that surveys one date folder (Phase 2's `day.json` +
`words.md` + staged media/files/location/contact), asks — once, in a batch —
only what a `TRACKS`-style check would still call missing, and proposes
creating the real entry once nothing is left to ask. Answering assigns the
day folder's content onto a brand-new entry in one press, rather than the
incremental back-and-forth `start_day`/`attach_files`/`draft_words` require
today.

**Architecture:** One new tool, `assemble_day` (name chosen for this plan;
adjust only if a naming collision turns up during implementation), replaces
none of `start_day`/`attach_files`/`draft_words` — those remain exactly as
they are for the case a person wants to build a day the old way, one step at
a time. `assemble_day` is a new front door for the case Phase 1/2 exist to
serve: everything for a date already sits in its folder, and the whole point
is asking once instead of once per field. Creating the entry composes the
same primitives `start_day`'s route and `attach_files`'s `attachStagedFiles`
already use (`createDraft`, `storeUploads`, `attachGallery`) directly, since
the day folder's media is a different physical location from the flat inbox
`attachStagedFiles` reads from — see Task 3's note on why it is a new
function rather than a call to the existing one.

**Tech Stack:** `lib/tracks.ts` (`TRACKS`, `TRACK_ROWS`, `missingFrom`,
`DayFacts`), `lib/dayReadiness.ts` (Phase 2), `lib/inbox.ts`'s day-folder
functions (Phase 2), `lib/api/entries.ts` (`createDraft`, `attachGallery`),
`lib/api/media.ts` (`storeUploads`), `lib/helper/tools/types.ts`'s
`Tool`/`Proposed` shape.

**Spec:** `docs/superpowers/specs/2026-09-12-inbox-day-assembly-design.md`
(Phase 3 section — "the conversation")

## Global Constraints

- **Never re-ask a field already answered.** A field with a real value, a
  `without` entry, or an `unrecorded` entry is not asked again in the same or
  a later turn — AGENTS.md's own rule ("a guard that fires on an honest turn
  is a bug") applied to this batch of questions. This is a hard requirement
  with its own test (Task 2), not an incidental nicety.
- **`weather` and photo captions are asked, but are not `TRACKS` rows.** They
  use the same three-answer shape (declined / look-it-up-or-say-it / a value)
  but are not folded into `lib/tracks.ts`'s registry in this phase — the spec
  leaves that as an open question for later. Do not add `"weather"` or
  `"caption"` to the `TRACKS` constant.
- **`time`/`timezone`/`transport`/`translations` never gate readiness.** They
  may be asked about conversationally when relevant (more than one entry for
  the date; more than one journal locale) but a day folder missing them is
  never why `assemble_day` refuses to propose creating the entry.
- **Nothing invented.** Every value this phase writes onto a real entry came
  from a person's own words, a real EXIF/geocode measurement already tagged
  as such (Phase 1), or an explicit decline/unknown — never a plausible
  guess. This is the same rule this whole project exists under; it is
  restated here because Task 3's entry-creation step is where every one of
  Phase 1 and 2's tagged fields finally lands on disk.
- **One git command per shell call, and clone `node_modules` with `cp -Rc`**
  — this repository's own worktree rules (AGENTS.md), unchanged by this plan.

---

### Task 1: What a day folder still owes, as a `Missing[]`-shaped list

**Files:**
- Create: `lib/dayMissing.ts`
- Test: `test/day-missing.test.ts`

**Interfaces:**
- Consumes: `readDayReadiness`, `listDayInbox`, `readWords` (Phase 2,
  `lib/dayReadiness.ts`/`lib/inbox.ts`); `Track`, `TRACKS`, `TRACK_ROWS`,
  `DayFacts`, `Tracks`, `missingFrom` (existing, `lib/tracks.ts`);
  `isEnabled` (existing, `lib/capabilities.ts`).
- Produces: `DayFolderMissing` type (a `TRACKS`-shaped item, plus `"weather"`
  and one entry per photo missing a caption, each carrying enough to render
  a question), `missingForDayFolder(username, date, tripTracks: Tracks): DayFolderMissing[]`.
  Task 2 is the only caller.

- [ ] **Step 1: Write the failing tests**

Create `test/day-missing.test.ts`. Reuse the `journal()` fixture and the
`storeInboxFile`/`moveInboxFileToDay`/`writeDayReadiness` functions from
Phase 1/2 — read those files first for their exact current signatures.

```ts
import { describe, expect, test } from "vitest";
import { missingForDayFolder } from "@/lib/dayMissing";
import { ALL_TRACKED } from "@/lib/tracks";

describe("missingForDayFolder", () => {
  test("an empty date folder, trip tracking everything, owes costs and coordinates but not photos", () => {
    journal();
    const missing = missingForDayFolder("u", "2026-05-04", ALL_TRACKED);
    const fields = missing.map((m) => m.field);
    expect(fields).toContain("costs");
    expect(fields).toContain("coordinates");
    expect(fields).not.toContain("photos"); // a `publish` row — not owed at creation
  });

  test("a folder with a location item owes nothing for coordinates", () => {
    journal();
    const { entry } = storeInboxFile("u", "location", "loc.json", Buffer.from("{}"), { lat: 1, lon: 2 });
    moveInboxFileToDay("u", entry.id, "2026-05-04");
    writeDayReadiness("u", "2026-05-04", { location: { lat: 1, lon: 2, source: "browser" } });
    const fields = missingForDayFolder("u", "2026-05-04", ALL_TRACKED).map((m) => m.field);
    expect(fields).not.toContain("coordinates");
  });

  test("a decline already on day.json is never asked again", () => {
    journal();
    writeDayReadiness("u", "2026-05-04", { without: ["costs"] });
    const fields = missingForDayFolder("u", "2026-05-04", ALL_TRACKED).map((m) => m.field);
    expect(fields).not.toContain("costs");
  });

  test("a trip that does not track costs never asks about it", () => {
    journal();
    const fields = missingForDayFolder("u", "2026-05-04", { ...ALL_TRACKED, costs: false }).map((m) => m.field);
    expect(fields).not.toContain("costs");
  });

  test("weather is asked only when a coordinate exists and the capability is on", () => {
    journal({ addressLookup: true, weather: true }); // check the real capability-enabling shape `journal()` supports; adjust flags to match
    let fields = missingForDayFolder("u", "2026-05-04", ALL_TRACKED).map((m) => m.field);
    expect(fields).not.toContain("weather"); // no coordinate yet

    const { entry } = storeInboxFile("u", "location", "loc.json", Buffer.from("{}"), { lat: 1, lon: 2 });
    moveInboxFileToDay("u", entry.id, "2026-05-04");
    writeDayReadiness("u", "2026-05-04", { location: { lat: 1, lon: 2, source: "browser" } });
    fields = missingForDayFolder("u", "2026-05-04", ALL_TRACKED).map((m) => m.field);
    expect(fields).toContain("weather");
  });

  test("weather already asked (declined or answered) is never asked again", () => {
    journal();
    const { entry } = storeInboxFile("u", "location", "loc.json", Buffer.from("{}"), { lat: 1, lon: 2 });
    moveInboxFileToDay("u", entry.id, "2026-05-04");
    writeDayReadiness("u", "2026-05-04", { location: { lat: 1, lon: 2, source: "browser" }, weatherAsked: true });
    const fields = missingForDayFolder("u", "2026-05-04", ALL_TRACKED).map((m) => m.field);
    expect(fields).not.toContain("weather");
  });

  test("one entry per photo still missing a caption, none for a photo already asked or already captioned", () => {
    journal();
    const { entry: a } = storeInboxFile("u", "media", "a.jpg", Buffer.from("a"), {});
    const { entry: b } = storeInboxFile("u", "media", "b.jpg", Buffer.from("b"), { caption: "the harbour" });
    const { entry: c } = storeInboxFile("u", "media", "c.jpg", Buffer.from("c"), { descriptionAsked: true });
    for (const e of [a, b, c]) moveInboxFileToDay("u", e.id, "2026-05-04");
    const captions = missingForDayFolder("u", "2026-05-04", ALL_TRACKED).filter((m) => m.field === "caption");
    expect(captions).toHaveLength(1);
    expect(captions[0].photoId).toBe(a.id);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/day-missing.test.ts`
Expected: FAIL — `lib/dayMissing.ts` does not exist.

- [ ] **Step 3: Write the implementation**

Create `lib/dayMissing.ts`:

```ts
import "server-only";
import { listDayInbox, readWords } from "./inbox";
import { readDayReadiness } from "./dayReadiness";
import { missingFrom, type DayFacts, type Track, type Tracks } from "./tracks";
import { isEnabled } from "./capabilities";

export type DayFolderMissing =
  | { field: Track; why: string; send: string; decline: string; unknown: string }
  | { field: "weather"; why: string }
  | { field: "caption"; why: string; photoId: string; filename: string };

/**
 * What a date folder still owes before `assemble_day` may propose creating
 * the real entry — Phase 3's whole reason to exist.
 *
 * Reuses `lib/tracks.ts`'s own `missingFrom` for the three registered rows
 * (`costs`, `coordinates`, `photos` — though `photos` is a `publish` row and
 * is asked `"write"` here, matching `start_day`'s own choice to only ask
 * `write`-time rows before an entry exists), and adds two more the registry
 * does not carry: `weather` (asked only once a coordinate exists — day.json's
 * `location`, or a real photo/entry lat/lng — and the capability is on) and
 * one `caption` question per photograph still missing one.
 */
export function missingForDayFolder(username: string, date: string, tripTracks: Tracks): DayFolderMissing[] {
  const readiness = readDayReadiness(username, date);
  const staged = listDayInbox(username, date);
  const words = readWords(username, date);

  const facts: DayFacts = {
    costs: false, // a date folder never carries costs directly in this phase
    coordinates: readiness.location !== undefined,
    photos: staged.media.length > 0,
    without: readiness.without,
    unrecorded: readiness.unrecorded,
  };
  const registered = missingFrom(facts, tripTracks, "write");

  const out: DayFolderMissing[] = [...registered];

  const hasCoordinate = readiness.location !== undefined;
  if (
    hasCoordinate &&
    !readiness.weatherAsked &&
    isEnabled("weather", username)
  ) {
    out.push({
      field: "weather",
      why: "This day has a place to look weather up for, and nobody has said whether to.",
    });
  }

  for (const photo of staged.media) {
    if (photo.caption || photo.descriptionAsked) continue;
    out.push({
      field: "caption",
      why: `${photo.filename} has no caption yet.`,
      photoId: photo.id,
      filename: photo.filename,
    });
  }

  // `words` is read but deliberately not turned into a `Missing` entry here:
  // whether prose is owed is Task 2's own "ready to propose" gate, not a
  // per-field question — an empty date folder with only a location pin and
  // no words at all is still allowed to ask "anything to say about this
  // day?" as part of the same batch, which Task 2 composes.
  void words;

  return out;
}
```

Check the real capability name for weather (`isEnabled("weather", username)`
is a guess at the string this codebase uses — grep `lib/capabilities.ts`'s
`FEATURE_NAMES` for the actual weather capability's name before trusting
this literally, and correct it if different).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/day-missing.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/dayMissing.ts test/day-missing.test.ts
git commit -m "What a date folder still owes before proposing to create it — reuses lib/tracks.ts, adds weather and per-photo captions (SDD plan: inbox day-assembly Phase 3, Task 1)"
```

---

### Task 2: `assemble_day` — survey, ask once, propose

**Files:**
- Create: `lib/helper/tools/areas/assemble.ts` (or add to
  `lib/helper/tools/areas/days.ts` alongside `start_day` — check how
  `lib/helper/tools/areas/*.ts` files are registered, e.g. a barrel file
  listing every area, and follow whichever convention keeps one area per
  file if that is the existing pattern)
- Modify: whichever file lists every tool area (find it — likely
  `lib/helper/tools/index.ts` or similar) to register the new tool
- Test: `test/helper-tool-assemble.test.ts` (new file; also expect to touch
  the same registry-wide tests Phase 1's Task 7 had to update — read that
  task's report in `docs/superpowers/plans/2026-09-12-inbox-day-assembly-phase-1.md`'s
  ledger for the exact list: a locale slot label, the sorted write-tool name
  list, `TOOLS.length`, a proposal-arguments row, the token-ceiling test)

**Interfaces:**
- Consumes: `missingForDayFolder` (Task 1); `readDayReadiness`,
  `writeDayReadiness`, `readWords`, `appendWords` (Phase 2); `listDayInbox`
  (Phase 2); `resolveTrip` (existing, `lib/helper/tools/resolve.ts`).
- Produces: nothing new consumed elsewhere in this plan — Task 3 is the
  separate confirm-side route this tool's `endpoint` points at.

- [ ] **Step 1: Read the existing tool shapes in full**

Read `lib/helper/tools/areas/days.ts`'s `start_day` (the whole tool
definition, including its `propose` function) and
`lib/helper/tools/areas/files.ts`'s `attach_files` and `invite_contact` (from
Phase 1) in full. Read `lib/helper/tools/types.ts`'s `Tool`/`Proposed` types
in full. This task's tool must match their conventions exactly: the 5-arg
`propose(username, args, say, today, selected)` signature, the `refuse`
field (a raw translation key, never `say(key)`) for a decline, `fields` with
`fixed`/`options`/`date` as `start_day` already demonstrates for exactly this
kind of multi-field batch proposal.

- [ ] **Step 2: Write the failing test**

Create `test/helper-tool-assemble.test.ts`. Find and reuse whatever test
harness `test/helper-tools.test.ts` or a sibling uses to call a tool's
`propose` function directly (rather than through the whole chat loop) — read
that file first.

```ts
describe("assemble_day", () => {
  test("a date with nothing missing proposes creating the day", async () => {
    // Set up: journal(), a trip with tracks off for everything except
    // photos-not-gating, a date folder with a location item, words, and
    // without:["costs"] already recorded. Call the tool's propose() and
    // assert the resulting `sentence`/`fields` describe a create-the-day
    // proposal rather than a question.
  });

  test("a date missing costs and weather asks about both in one sentence", async () => {
    // A date folder with a location item (so weather is askable) and no
    // without/unrecorded for costs. Assert the proposal's `sentence`
    // mentions both, and `fields` carries an answer slot for each.
  });

  test("a field already declined is never asked again, even with other fields still missing", () => {
    // without: ["costs"], weatherAsked: false, coordinates present. Assert
    // the proposal's fields ask about weather only, not costs.
  });

  test("undated content implying more than one day asks which, before anything else", () => {
    // Two photos in the flat (undated) inbox with different EXIF takenAt
    // dates far enough apart to imply two days — assert the tool's
    // propose() surfaces a "one day, or several?" question rather than
    // surveying any single date folder yet.
  });
});
```

This step's test bodies are intentionally left as descriptions rather than
exact code: the concrete shape of a `propose()` call and its `Proposed`
return depends on exactly what Task 2's own implementation ends up
producing, and inventing exact assertions before the tool is designed risks
locking in the wrong interface. Write the concrete test code as you build
Step 4 below, TDD-style — write one test, make it pass, move to the next —
rather than all four up front.

- [ ] **Step 3: Run the first test to verify it fails**

Run: `npx vitest run test/helper-tool-assemble.test.ts`
Expected: FAIL — the tool does not exist.

- [ ] **Step 4: Write `assemble_day`**

The tool's shape, following `start_day`'s own pattern closely:

```ts
{
  name: "assemble_day",
  kind: "write",
  renders: "form",
  describe:
    "Survey a date's staged content (photos, a location, words already said) and either ask what's still missing, or propose creating the day when nothing is. The natural door once photos, a location or a note have already landed for a date — prefer this over start_day when a date's own folder already has something in it.",
  properties: {
    ...TRIP_ARG,
    date: { type: "string", description: "The date to assemble, as YYYY-MM-DD." },
  },
  endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/assemble-day`,
  propose: async (username, args, say, today, selected) => {
    const trip = resolveTrip(username, args.trip);
    const date = args.date ?? today;

    const missing = missingForDayFolder(username, date, trip?.tracks ?? ALL_TRACKED);
    if (missing.length > 0) {
      // Ask, once, about everything still missing — never split across
      // fields already answered (declined/unrecorded/answered are filtered
      // out by missingForDayFolder itself, so anything reaching here is
      // genuinely unasked).
      return {
        sentence: say("agent.tool.assembleDayMissing", { date, count: String(missing.length) }),
        accept: say("agent.tool.assembleDayAsk"),
        done: say("agent.tool.assembleDayAsked"),
        fields: missing.map((m) => fieldFor(m, say)),
      };
    }

    const readiness = readDayReadiness(username, date);
    const staged = listDayInbox(username, date);
    const words = readWords(username, date);
    return {
      sentence: say("agent.tool.assembleDayReady", { date, photos: String(staged.media.length) }),
      accept: say("agent.tool.assembleDayCreateAccept"),
      done: say("agent.tool.assembleDayCreateDone"),
      preview: [words.slice(0, 200)].filter((line) => line !== ""),
      fields: [
        { name: "trip", value: trip?.id ?? "", fixed: true },
        { name: "date", value: date, fixed: true },
      ],
    };
  },
},
```

`fieldFor(m, say)` is a small helper this task writes, turning one
`DayFolderMissing` item into the same `{ name, value, options }` shape
`start_day` already builds for its own `asked.map(...)` — read that mapping
in full and match its option shapes (`unknown`/`none` for `TRACKS` rows;
design the equivalent two- or three-option set for `weather` and `caption`
questions, matching `TRACK_ROWS`'s `decline`/`unknown` sentence style).

Verify `ALL_TRACKED`, `resolveTrip`, `TRIP_ARG` import paths against the real
current files before writing this — they are used elsewhere in this same
directory and their exact import paths are visible in `days.ts`'s own
imports.

**The "several days from one batch" question** (Global Constraint from the
spec): when `args.date` is omitted and the flat (undated) inbox holds
content whose EXIF `takenAt` or WhatsApp `receivedAt` implies more than one
distinct date, `propose` should surface a question ("one day, or several?")
before surveying any single date folder — this is its own `fields` shape
(a list of the distinct dates found, each with a yes/no or an assignment
choice) rather than the missing-fields batch above. Write this as a second
early-return in `propose`, before the `missingForDayFolder` call, gated on
`args.date` being absent and more than one distinct date being found among
undated `listInbox(username)` entries' `takenAt`/`receivedAt` fields.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/helper-tool-assemble.test.ts`
Expected: PASS

- [ ] **Step 6: Register the tool and fix the registry-wide fallout**

Register `assemble_day` wherever the other tool areas are listed. Then run
the full suite once to find what else needs updating — Phase 1's Task 7 hit
four such tests (a locale slot label, the sorted write-tool name list,
`TOOLS.length`, a proposal-arguments row) plus a token-ceiling test that may
need raising with its own justification paragraph (read that test's own
documented process before touching `CEILING`). Add the locale keys this
tool's `say(...)` calls reference (`agent.tool.assembleDay*`) to all three
locale files with real translations, then `npm run i18n:keys`.

- [ ] **Step 7: Run the full regression**

Run: `npx vitest run` (the whole suite — this task touches a shared registry
several other tests assert against).
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add lib/helper/tools/areas/ lib/i18n.ts site/locales/ test/
git commit -m "assemble_day: survey a date folder, ask once what's missing, propose creating it once nothing is (SDD plan: inbox day-assembly Phase 3, Task 2)"
```

---

### Task 3: The confirm route — creating the entry from a day folder

**Files:**
- Create: `app/api/helper/[user]/assemble-day/route.ts`
- Create: `lib/dayFolderAttach.ts` (the new attach function this route needs
  — see the note below on why it is not `attachStagedFiles`)
- Test: `test/assemble-day-route.test.ts`

**Interfaces:**
- Consumes: `createDraft`, `attachGallery` (existing, `lib/api/entries.ts`);
  `storeUploads` (existing, `lib/api/media.ts`); `listDayInbox`,
  `removeDayInboxFile`, `dayInboxDir` (Phase 2, `lib/inbox.ts`);
  `readDayReadiness`, `readWords` (Phase 2, `lib/dayReadiness.ts`);
  `missingForDayFolder` (Task 1, only to double-check nothing is missing
  before writing — the same "ask again at the door" pattern
  `POST .../day`'s own `missingFrom` check already uses).

**Why a new attach function, not `attachStagedFiles`:** `attachStagedFiles`
(`lib/api/staged.ts`) resolves ids through `findInboxFile`/`removeInboxFile`,
which search the **flat** bucket (`content/<user>/inbox/<kind>/`). Phase 2
physically moves dated content into `content/<user>/inbox/days/<date>/<kind>/`
— a different location `findInboxFile` never looks at. Reusing
`attachStagedFiles` verbatim would silently attach nothing (every id would
resolve to "unknown"). The correct fix is not to widen `findInboxFile`'s
search space (that would make `attach_files`'s "everything waiting" query
in the flat inbox start including dated content too, which Phase 2's whole
point was to stop) — it is a small sibling function reading from the day
folder instead, composing the same two underlying primitives
(`storeUploads`, `attachGallery`) `attachStagedFiles` already composes.

- [ ] **Step 1: Write the failing test**

Create `test/assemble-day-route.test.ts`. Reuse the cookie-session test
pattern from a sibling helper route test (`test/helper-day-route.test.ts` or
similar — find the closest existing test of `app/api/helper/[user]/day/route.ts`
and copy its session/fixture setup).

```ts
test("creates the day from a ready date folder: words, photos, and readiness answers all land on the new entry", async () => {
  // journal(), a trip, a date folder with: a stored media file (via
  // storeInboxFile + moveInboxFileToDay), appendWords() called with some
  // prose, writeDayReadiness() with without:["costs"] and a location.
  // POST to the route with { trip, date }.
  // Assert: 201, the new entry's content matches the words.md prose, its
  // gallery has one item, its frontmatter carries without:["costs"], its
  // lat/lng match the day.json location, and the day folder no longer
  // exists on disk afterwards.
});

test("refuses if something is still missing — the door asks again, same as POST .../day", async () => {
  // A date folder missing costs, no without/unrecorded recorded.
  // Assert: 422, same incomplete_day shape POST .../day already answers.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/assemble-day-route.test.ts`
Expected: FAIL — neither the route nor `lib/dayFolderAttach.ts` exists.

- [ ] **Step 3: Write `lib/dayFolderAttach.ts`**

```ts
import "server-only";
import fs from "node:fs";
import { listDayInbox, removeDayInboxFile, dayInboxDir } from "./inbox";
import { storeUploads } from "./api/media";
import { attachGallery } from "./api/entries";
import type { UploadCandidate } from "./api/media";

/**
 * Move a date folder's staged photographs onto a just-created entry —
 * Phase 3's own version of what `attachStagedFiles` (`lib/api/staged.ts`)
 * does for the flat inbox, reading from `inbox/days/<date>/` instead.
 *
 * Composes the same two primitives `attachStagedFiles` composes
 * (`storeUploads`, `attachGallery`) rather than calling it, because its id
 * resolution (`findInboxFile`/`removeInboxFile`) only ever looks at the flat
 * bucket — see this task's own note in the plan for why widening that
 * search space is the wrong fix.
 */
export async function attachDayFolderMedia(
  username: string,
  ref: string,
  date: string,
  slug: string,
): Promise<{ ok: true; attached: number } | { ok: false; error: string }> {
  const staged = listDayInbox(username, date).media;
  if (staged.length === 0) return { ok: true, attached: 0 };

  const uploads: UploadCandidate[] = staged.map((entry) => ({
    filename: entry.filename,
    bytes: fs.readFileSync(`${dayInboxDir(username, date, "media")}/${entry.id}`),
    caption: entry.caption,
  }));

  const written = await storeUploads(ref, slug, uploads);
  if (!written.ok) return { ok: false, error: "invalid_media" };

  const attached = attachGallery(ref, slug, written.items);
  if (!attached.ok) return { ok: false, error: attached.error };

  for (const entry of staged) removeDayInboxFile(username, date, entry.id);
  return { ok: true, attached: attached.attached };
}
```

Verify `UploadCandidate`'s real field names (`filename`, `bytes`, `caption`,
`visibility`) against `lib/api/media.ts` before trusting this snippet — it
was written from `attachStagedFiles`'s own construction of the same type,
read in Phase 3's research, but confirm directly.

- [ ] **Step 4: Write the route**

`app/api/helper/[user]/assemble-day/route.ts`, matching
`app/api/helper/[user]/day/route.ts`'s own shape closely (cookie-only,
owner-only, `dynamic = "force-dynamic"`):

```ts
import { createDraft, type DraftInput } from "@/lib/api/entries";
import { attachDayFolderMedia } from "@/lib/dayFolderAttach";
import { readDayReadiness, readWords } from "@/lib/dayReadiness";
import { missingForDayFolder } from "@/lib/dayMissing";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { refused, wrote } from "@/lib/helper/thread";
import { withoutLine, unrecordedLine } from "@/lib/tracks"; // check whether these
  // render markdown *lines* (this file's own convention) or need a different
  // helper to produce request-body fields instead — read createDraft's own
  // handling of `without`/`unrecorded` in DraftInput (if it has one) before
  // assuming these two functions are the right call here; they may only be
  // for the markdown-writer path (lib/api/entries.ts's own file writer),
  // not for a DraftInput a route builds.
import { getTrip, tripRef } from "@/lib/trips";
import fs from "node:fs";
import { dayInboxDir } from "@/lib/inbox";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: RouteContext<"/api/helper/[user]/assemble-day">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) return notYourJournal(request, user);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const tripId = String(body.trip ?? "");
  const date = String(body.date ?? "");
  const ref = tripRef(user, tripId);
  const trip = getTrip(ref);
  if (!trip) {
    refused(user, "assemble_day", "unknown_trip");
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }

  const missing = missingForDayFolder(user, date, trip.tracks);
  if (missing.length > 0) {
    refused(user, "assemble_day", "incomplete_day");
    return Response.json({ error: "incomplete_day", missing: missing.map((m) => m.field) }, { status: 422 });
  }

  const readiness = readDayReadiness(user, date);
  const words = readWords(user, date);

  const input: DraftInput = {
    title: date,
    date,
    content: words || "…", // NO_PROSE's own placeholder if truly nothing was said
    ...(readiness.location ? { lat: readiness.location.lat, lng: readiness.location.lon } : {}),
    without: readiness.without,
    unrecorded: readiness.unrecorded,
  };

  const written = createDraft(ref, input);
  if (!written.ok) {
    refused(user, "assemble_day", written.code ?? written.error);
    return Response.json({ error: written.code ?? written.error }, { status: 400 });
  }

  const attached = await attachDayFolderMedia(user, ref, date, written.slug);
  if (!attached.ok) {
    // The entry exists; the photos did not move. Report both rather than
    // hiding the partial success — the same shape a caller can act on, not
    // a rollback (this codebase never rolls an entry back once written).
    return Response.json({ ok: true, trip: tripId, slug: written.slug, mediaError: attached.error }, { status: 201 });
  }

  // The day folder's job was staging; remove it now that a real entry holds
  // everything it carried.
  fs.rmSync(dayInboxDir(user, date), { recursive: true, force: true });

  wrote(user, "assemble_day", { trip: tripId, slug: written.slug, date });
  return Response.json({ ok: true, trip: tripId, slug: written.slug, attached: attached.attached }, { status: 201 });
}
```

Before trusting this verbatim: check whether `DraftInput` actually accepts
`without`/`unrecorded` fields directly (grep `lib/api/entries.ts`'s
`DraftInput` type and `createDraft`'s handling of them — Phase 3's earlier
research found `declinesIn(body)` used by `POST .../day`'s route to build
these from a request body's `answers`, which may mean `DraftInput` expects
them under a different shape than plain arrays). Adjust the route to match
whatever `createDraft` actually accepts, verified fresh rather than assumed
from this plan.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/assemble-day-route.test.ts`
Expected: PASS

- [ ] **Step 6: Add the route to the contract**

Per AGENTS.md: a new route under `app/api/**` needs an entry somewhere its
family is documented. Check whether `/api/helper/**` routes are in
`lib/api/openapi.ts` at all (Phase 1's `invite-contact` route was **not**
added there — helper routes are a separate, undocumented-by-openapi surface,
confirmed during Phase 1). If that holds, no `openapi.ts` change is needed;
if it does not, add one following whatever convention the nearest sibling
`/api/helper/**` route follows.

- [ ] **Step 7: Commit**

```bash
git add app/api/helper/\[user\]/assemble-day/ lib/dayFolderAttach.ts test/assemble-day-route.test.ts
git commit -m "The confirm route: create a real entry from a ready date folder, attach its photos, remove the folder (SDD plan: inbox day-assembly Phase 3, Task 3)"
```

---

## Final check

- [ ] Run `npm run verify` in full.
- [ ] `test-in-a-browser`: sign in as an owner, stage a photo and a note for
  a date through `/agent`, confirm `assemble_day` (however it surfaces in
  the room's UI) asks what's still missing, answer, press to create, and
  confirm the day appears with the words, the photo, and the frontmatter
  this plan wrote.
- [ ] Confirm the day folder is genuinely gone from disk after a successful
  create — this is the one behavior no unit test alone proves end to end
  (Task 3's own test does check it, but a browser pass is the honest
  end-to-end confirmation this codebase's AGENTS.md asks for before calling
  a visible change finished).

## Open items this plan does not resolve, on purpose

- The exact wording of every `agent.tool.assembleDay*` locale string is left
  to whoever implements Task 2 — a prose decision, not an architecture one,
  per the spec's own "open questions" section.
- Whether a day folder that never reaches "ready" needs its own cleanup or
  its own surfacing in a history panel is explicitly out of scope here — the
  spec calls it "likely yes, a `test-in-a-browser` question once phase 3
  exists to look at," which is now.
