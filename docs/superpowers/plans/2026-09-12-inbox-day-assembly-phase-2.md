# Inbox day-assembly Phase 2: the day folder and its readiness record — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a date its own staging folder under a journal's inbox
(`content/<user>/inbox/days/<date>/`), holding a `day.json` readiness record
(built on `lib/tracks.ts`'s existing vocabulary rather than a new one) and a
`words.md` for accumulating prose — the structure Phase 3's conversation reads
from and Phase 1's new inbox content (location pins, contacts, EXIF-tagged
photos) can be tied to once a date is known.

**Architecture:** A day folder is a sibling of the existing flat
`inbox/<kind>/` buckets, not a replacement — `content/<user>/inbox/media/`
etc. keep holding genuinely undated content exactly as Phase 1 left them.
Tying an item to a date **physically moves its file + sidecar** into
`inbox/days/<date>/<kind>/`, which is why every new function here has a
"moved out of the flat bucket, into the day folder" shape rather than a
separate index pointing at unmoved files. `day.json` and `words.md` are new
sibling files at the day folder's root, both plain JSON/markdown reachable by
nothing under `app/` except through the new functions this plan adds.

**Tech Stack:** Node `fs`, existing `lib/tracks.ts` vocabulary (`Track`,
`DayFacts`, `missingFrom`, `withoutLine`/`unrecordedLine`,
`parseWithout`/`parseUnrecorded`), existing `lib/inbox.ts` sidecar shape
(`InboxMeta`, `InboxEntry`).

**Spec:** `docs/superpowers/specs/2026-09-12-inbox-day-assembly-design.md`
(Phase 2 section — "the day folder and its readiness record")

## Global Constraints

- **`day.json` speaks `lib/tracks.ts`'s vocabulary, never a new one.** Every
  field with an existing home (`Track`, `without`, `unrecorded`) uses exactly
  that shape, so turning it into a real entry's frontmatter (Phase 3) is a
  direct copy through `withoutLine`/`unrecordedLine`, unchanged.
- **Nothing in `day.json` claims a value a directory listing could already
  answer.** Photographs actually present and words actually written stay
  derived — read straight off the folder — never duplicated into `day.json`
  as a separate fact that could disagree with the folder.
- **`gps/` stays untouched by this phase.** Phase 5 wires it in later; this
  plan's `location` field is populated only from Phase 1's browser button and
  WhatsApp pin, both already flowing through `storeInboxFile`.
- **A day folder is scratch, not content a person has committed to.** It is
  gitignored the same way `content/<user>/inbox/` already is (nothing new
  needed there — it is a subdirectory of the existing gitignored inbox).
- **One git command per shell call, and clone `node_modules` with `cp -Rc`**
  — this repository's own worktree rules (AGENTS.md), unchanged by this plan.

---

### Task 1: The day-folder path helpers and the physical move

**Files:**
- Modify: `lib/inbox.ts` (new exports, no changes to existing ones)
- Test: `test/inbox-days.test.ts` (new file)

**Interfaces:**
- Produces: `dayInboxDir(username: string, date: string, kind?: InboxKind): string`
  — mirrors `inboxDir`, but under `inbox/days/<date>/` instead of `inbox/`.
  `listDayInbox(username: string, date: string): Record<InboxKind, InboxEntry[]>`
  — mirrors `listInbox`, scoped to one date folder.
  `moveInboxFileToDay(username: string, id: string, date: string): { entry: InboxEntry } | null`
  — physically relocates a file + its sidecar from the flat bucket
  (`findInboxFile`'s search space) into `inbox/days/<date>/<kind>/`, keeping
  the same `id`. `null` when the id is not in the flat bucket (already dated,
  or never existed).
  `findDayInboxFile(username: string, date: string, id: string): { entry: InboxEntry; file: string } | null`
  — mirrors `findInboxFile`, scoped to one date folder (Phase 3 needs this to
  resolve a specific staged item before removing it).
  `removeDayInboxFile(username: string, date: string, id: string): boolean`
  — mirrors `removeInboxFile`, scoped to one date folder (Phase 3 uses this
  after moving a file into a real entry).
- Consumes: `INBOX_KINDS`, `InboxKind`, `InboxEntry`, `inboxDir`, `findInboxFile`
  (all existing, `lib/inbox.ts`).

- [ ] **Step 1: Write the failing tests**

Create `test/inbox-days.test.ts`. Reuse the `journal()` fixture pattern from
`test/helper-room-files.test.ts` (a `CONTENT_DIR` temp dir with a
`config.json` and a user folder) rather than writing a third copy of it —
read that file first to copy its exact fixture helper.

```ts
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  storeInboxFile,
  findInboxFile,
  dayInboxDir,
  listDayInbox,
  moveInboxFileToDay,
  findDayInboxFile,
  removeDayInboxFile,
} from "@/lib/inbox";

// journal() fixture copied from test/helper-room-files.test.ts — see that
// file for the exact CONTENT_DIR + config.json setup this plan assumes.

describe("moveInboxFileToDay", () => {
  test("moves a flat-bucket file's bytes and sidecar into the date folder, keeping its id", () => {
    journal();
    const { entry } = storeInboxFile("u", "media", "sunset.jpg", Buffer.from("bytes"), { lat: 1, lon: 2 });
    const moved = moveInboxFileToDay("u", entry.id, "2026-05-04");
    expect(moved?.entry.id).toBe(entry.id);
    expect(moved?.entry.lat).toBe(1); // the sidecar's facts survive the move

    // Gone from the flat bucket.
    expect(findInboxFile("u", entry.id)).toBeNull();
    // Present in the date folder.
    const there = findDayInboxFile("u", "2026-05-04", entry.id);
    expect(there?.entry.id).toBe(entry.id);
    expect(fs.existsSync(path.join(dayInboxDir("u", "2026-05-04", "media"), entry.id))).toBe(true);
  });

  test("an id already dated, or never staged, moves nothing and answers null", () => {
    journal();
    expect(moveInboxFileToDay("u", "no-such-id.jpg", "2026-05-04")).toBeNull();
  });
});

describe("listDayInbox", () => {
  test("lists only what has been moved into this date, grouped by kind", () => {
    journal();
    const { entry: a } = storeInboxFile("u", "media", "a.jpg", Buffer.from("a"), {});
    storeInboxFile("u", "media", "b.jpg", Buffer.from("b"), {}); // stays undated
    moveInboxFileToDay("u", a.id, "2026-05-04");
    const day = listDayInbox("u", "2026-05-04");
    expect(day.media.map((e) => e.id)).toEqual([a.id]);
    expect(day.files).toEqual([]);
  });

  test("an unknown date reads as empty, not as an error", () => {
    journal();
    expect(listDayInbox("u", "2099-01-01").media).toEqual([]);
  });
});

describe("removeDayInboxFile", () => {
  test("takes a file out of the date folder, bytes and sidecar both", () => {
    journal();
    const { entry } = storeInboxFile("u", "media", "c.jpg", Buffer.from("c"), {});
    moveInboxFileToDay("u", entry.id, "2026-05-04");
    expect(removeDayInboxFile("u", "2026-05-04", entry.id)).toBe(true);
    expect(findDayInboxFile("u", "2026-05-04", entry.id)).toBeNull();
    expect(removeDayInboxFile("u", "2026-05-04", entry.id)).toBe(false); // already gone
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/inbox-days.test.ts`
Expected: FAIL — none of the five new exports exist yet.

- [ ] **Step 3: Add the day-folder path helpers to `lib/inbox.ts`**

Read the current file in full first — `inboxDir`, `sidecarPath`,
`readSidecar`, `storeInboxFile`, `listInbox`, `findInboxFile`,
`removeInboxFile` are all private helpers this task reuses rather than
duplicates. Add, after the existing `removeInboxFile`:

```ts
/** `content/<user>/inbox/days/<date>/`, the same shape as the flat bucket
 *  but scoped to one date — Phase 2's staging area. `date` is trusted to be
 *  an ISO `YYYY-MM-DD` by every caller in this file; nothing here validates
 *  it, because every caller already has it from a place that did (a
 *  WhatsApp message's own timestamp, or a person answering "which day"). */
export function dayInboxDir(username: string, date: string, kind?: InboxKind): string {
  const root = path.join(userDir(username), "inbox", "days", date);
  return kind ? path.join(root, kind) : root;
}

function daySidecarPath(username: string, date: string, kind: InboxKind, id: string): string {
  return path.join(dayInboxDir(username, date, kind), `${id}.meta.json`);
}

/** Everything staged for one date, by kind. Mirrors `listInbox`, scoped to a
 *  date folder rather than the flat bucket. An unknown date reads as every
 *  kind empty, not as an error — a date nobody has staged anything for yet
 *  is the ordinary case, not a failure. */
export function listDayInbox(username: string, date: string): Record<InboxKind, InboxEntry[]> {
  const out = {} as Record<InboxKind, InboxEntry[]>;
  for (const kind of INBOX_KINDS) {
    const dir = dayInboxDir(username, date, kind);
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      out[kind] = [];
      continue;
    }
    out[kind] = names
      .filter((n) => n.endsWith(".meta.json"))
      .map((n) => readSidecar(path.join(dir, n), kind))
      .filter((e): e is InboxEntry => e !== null && fs.existsSync(path.join(dir, e.id)))
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }
  return out;
}

/** One staged file for one date, by id. Mirrors `findInboxFile`, scoped to a
 *  date folder. `path.basename` on `id` is the same path-traversal guard
 *  `findInboxFile` applies — an id reaches here from a request body. */
export function findDayInboxFile(
  username: string,
  date: string,
  id: string,
): { entry: InboxEntry; file: string } | null {
  const safe = path.basename(id);
  for (const kind of INBOX_KINDS) {
    const dir = dayInboxDir(username, date, kind);
    const file = path.join(dir, safe);
    const sidecar = daySidecarPath(username, date, kind, safe);
    if (fs.existsSync(file) && fs.existsSync(sidecar)) {
      const entry = readSidecar(sidecar, kind);
      if (entry) return { entry, file };
    }
  }
  return null;
}

/** Take a staged file out of a date folder, sidecar and all. `true` if it
 *  was there. Mirrors `removeInboxFile`, scoped to a date folder — Phase 3
 *  calls this once a file has been moved into a real entry's own media. */
export function removeDayInboxFile(username: string, date: string, id: string): boolean {
  const found = findDayInboxFile(username, date, id);
  if (!found) return false;
  fs.rmSync(found.file, { force: true });
  fs.rmSync(daySidecarPath(username, date, found.entry.kind, found.entry.id), { force: true });
  return true;
}

/**
 * Tie a flat-bucket file to a date — moving its bytes and sidecar out of
 * `inbox/<kind>/` and into `inbox/days/<date>/<kind>/`, keeping the same id.
 *
 * A **move**, not a copy or an index entry, per the spec: the flat bucket is
 * for undated content, so a dated item has no business still answering to
 * `listInbox`/`findInboxFile`/`attach_files`'s "everything waiting" query
 * once it has a date. `null` when the id is not presently in the flat
 * bucket — already moved, or never staged there at all.
 */
export function moveInboxFileToDay(
  username: string,
  id: string,
  date: string,
): { entry: InboxEntry } | null {
  const found = findInboxFile(username, id);
  if (!found) return null;
  const { entry } = found;
  const destDir = dayInboxDir(username, date, entry.kind);
  fs.mkdirSync(destDir, { recursive: true });
  fs.renameSync(found.file, path.join(destDir, entry.id));
  fs.renameSync(
    sidecarPathFor(username, entry.kind, entry.id),
    daySidecarPath(username, date, entry.kind, entry.id),
  );
  return { entry };
}
```

`sidecarPathFor` does not exist yet under that name — `lib/inbox.ts`'s
existing private helper is `sidecarPath(username, kind, id)` (unexported).
Use that directly rather than inventing a second name; the snippet above
names it `sidecarPathFor` only to distinguish it from the new
`daySidecarPath` while explaining the shape — **write the real code calling
the existing private `sidecarPath`**, not a new function.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/inbox-days.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/inbox.ts test/inbox-days.test.ts
git commit -m "Day-folder path helpers: move a staged file from the flat inbox into a date's own folder (SDD plan: inbox day-assembly Phase 2, Task 1)"
```

---

### Task 2: `day.json` — the readiness record, built on `lib/tracks.ts`

**Files:**
- Create: `lib/dayReadiness.ts`
- Test: `test/day-readiness.test.ts`

**Interfaces:**
- Consumes: `Track`, `TRACKS`, `DayFacts`, `parseWithout`, `parseUnrecorded`,
  `withoutLine`, `unrecordedLine` (all existing, `lib/tracks.ts`);
  `listDayInbox`, `dayInboxDir` (Task 1, `lib/inbox.ts`).
- Produces: `DayReadiness` type, `readDayReadiness(username, date): DayReadiness`,
  `writeDayReadiness(username, date, patch: Partial<DayReadiness>): DayReadiness`,
  `wordsPathFor(username, date): string`, `readWords(username, date): string`,
  `appendWords(username, date, paragraph: string): void`. Every later task in
  Phase 3 reads or writes through these, never through raw `fs` calls on
  `day.json`/`words.md` directly.

- [ ] **Step 1: Write the failing tests**

Create `test/day-readiness.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  readDayReadiness,
  writeDayReadiness,
  readWords,
  appendWords,
} from "@/lib/dayReadiness";

describe("readDayReadiness", () => {
  test("a date nobody has touched reads as nothing decided yet", () => {
    journal();
    const r = readDayReadiness("u", "2026-05-04");
    expect(r.without).toEqual([]);
    expect(r.unrecorded).toEqual([]);
    expect(r.weatherAsked).toBe(false);
    expect(r.location).toBeUndefined();
  });

  test("round-trips through writeDayReadiness", () => {
    journal();
    writeDayReadiness("u", "2026-05-04", { without: ["costs"], weatherAsked: true });
    const r = readDayReadiness("u", "2026-05-04");
    expect(r.without).toEqual(["costs"]);
    expect(r.weatherAsked).toBe(true);
  });

  test("a patch merges rather than replaces — a second write does not erase the first", () => {
    journal();
    writeDayReadiness("u", "2026-05-04", { without: ["costs"] });
    writeDayReadiness("u", "2026-05-04", { weatherAsked: true });
    const r = readDayReadiness("u", "2026-05-04");
    expect(r.without).toEqual(["costs"]);
    expect(r.weatherAsked).toBe(true);
  });

  test("location carries its source, same vocabulary as InboxMeta", () => {
    journal();
    writeDayReadiness("u", "2026-05-04", { location: { lat: 46.02, lon: 7.75, source: "browser" } });
    expect(readDayReadiness("u", "2026-05-04").location?.source).toBe("browser");
  });
});

describe("words.md", () => {
  test("starts empty, and each appendWords call adds a paragraph", () => {
    journal();
    expect(readWords("u", "2026-05-04")).toBe("");
    appendWords("u", "2026-05-04", "We arrived late.");
    appendWords("u", "2026-05-04", "The hotel was full of cats.");
    expect(readWords("u", "2026-05-04")).toBe("We arrived late.\n\nThe hotel was full of cats.");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/day-readiness.test.ts`
Expected: FAIL — `lib/dayReadiness.ts` does not exist.

- [ ] **Step 3: Write the minimal implementation**

Create `lib/dayReadiness.ts`:

```ts
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { dayInboxDir } from "./inbox";
import { parseUnrecorded, parseWithout, type Track } from "./tracks";

/**
 * `day.json` — what a date folder knows about itself, before there is a real
 * entry to know it instead — B1573's Phase 2.
 *
 * Speaks `lib/tracks.ts`'s vocabulary rather than a new one: `without` and
 * `unrecorded` are exactly `Track[]`, the same values `withoutLine`/
 * `unrecordedLine` already render into an entry's frontmatter, so handing
 * this record to Phase 3's day-creation step is a direct copy, not a
 * translation. `weatherAsked` mirrors `Entry.weatherAsked` the same way.
 *
 * What is deliberately absent: whether photographs exist (read the folder),
 * whether words exist (read `words.md`). A day folder answering a question
 * the folder itself could already answer is a second copy of a fact that
 * could disagree with the first.
 */
export type DayReadiness = {
  without: Track[];
  unrecorded: Track[];
  weatherAsked: boolean;
  /** A coordinate this date is tied to, and where it came from — the same
   *  three-word vocabulary `InboxMeta.source` uses for a file's own origin,
   *  restated here because a day's location may come from the browser
   *  button, a WhatsApp pin, or (Phase 5) an extracted GPS fix, and a later
   *  reader needs to tell those apart exactly as it does for a photograph. */
  location?: { lat: number; lon: number; source: "browser" | "whatsapp" | "gps" };
};

const EMPTY: DayReadiness = { without: [], unrecorded: [], weatherAsked: false };

function readinessPath(username: string, date: string): string {
  return path.join(dayInboxDir(username, date), "day.json");
}

/** What this date folder currently says about itself. A date with no folder
 *  yet, or a `day.json` that fails to parse, reads as `EMPTY` — the honest
 *  answer for "nothing decided" and for "nothing written down" alike. */
export function readDayReadiness(username: string, date: string): DayReadiness {
  try {
    const raw = JSON.parse(fs.readFileSync(readinessPath(username, date), "utf8")) as Partial<DayReadiness>;
    return {
      without: parseWithout(raw.without),
      unrecorded: parseUnrecorded(raw.unrecorded),
      weatherAsked: raw.weatherAsked === true,
      location: raw.location,
    };
  } catch {
    return { ...EMPTY };
  }
}

/** Merge a patch into what this date folder already says — never a
 *  replace, so answering one question in a batch cannot silently erase an
 *  earlier answer to a different one. */
export function writeDayReadiness(
  username: string,
  date: string,
  patch: Partial<DayReadiness>,
): DayReadiness {
  const current = readDayReadiness(username, date);
  const merged: DayReadiness = {
    without: patch.without ?? current.without,
    unrecorded: patch.unrecorded ?? current.unrecorded,
    weatherAsked: patch.weatherAsked ?? current.weatherAsked,
    location: patch.location ?? current.location,
  };
  const dir = dayInboxDir(username, date);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(readinessPath(username, date), `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}

function wordsPath(username: string, date: string): string {
  return path.join(dayInboxDir(username, date), "words.md");
}

/** The prose accumulated for this date so far. Empty string for a date with
 *  no `words.md` yet — nothing said, not an error. */
export function readWords(username: string, date: string): string {
  try {
    return fs.readFileSync(wordsPath(username, date), "utf8").trimEnd();
  } catch {
    return "";
  }
}

/** Add one paragraph — a sentence somebody typed, or a transcription — to
 *  this date's accumulated words. Never overwrites what is already there;
 *  every call appends, blank-line separated, the ordinary markdown paragraph
 *  break. */
export function appendWords(username: string, date: string, paragraph: string): void {
  const dir = dayInboxDir(username, date);
  fs.mkdirSync(dir, { recursive: true });
  const existing = readWords(username, date);
  const next = existing === "" ? paragraph : `${existing}\n\n${paragraph}`;
  fs.writeFileSync(wordsPath(username, date), `${next}\n`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/day-readiness.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/dayReadiness.ts test/day-readiness.test.ts
git commit -m "day.json and words.md: a date folder's own readiness record, built on lib/tracks.ts's vocabulary (SDD plan: inbox day-assembly Phase 2, Task 2)"
```

---

### Task 3: Wire Phase 1's new content into the day folder

**Files:**
- Modify: `lib/whatsapp/dispatch.ts` (`handleLocationPin`, dated pins only)
- Modify: `components/HelperRoom.tsx` or wherever the browser
  "share my current location" handler lives (Task 4 of the Phase 1 plan) —
  **only if** a date is already known in that context; otherwise leave it
  landing undated, unchanged
- Test: extend `test/whatsapp-location-contact.test.ts`

**Interfaces:**
- Consumes: `moveInboxFileToDay`, `writeDayReadiness` (Task 1/2).

**Why this task exists, and why it is small:** the spec says a WhatsApp
location pin "already knows the date from the message timestamp, so this one
files straight into the date's staging folder... rather than landing
undated." Everything else Phase 1 built (the browser button, WhatsApp
contacts, EXIF-tagged photos) has **no date to file under yet** — a person's
current location, an arbitrary shared contact, and an uploaded photo are all
genuinely undated until a conversation (Phase 3) ties them to one. So this
task changes exactly one code path: `handleLocationPin`.

- [ ] **Step 1: Read the current `handleLocationPin` in full**

`lib/whatsapp/dispatch.ts` — find it (Phase 1's Task 6 rewrote it to call
`storeInboxFile(username, "location", ..., { lat, lon, source: "whatsapp", receivedAt })`
with no date). Read the whole function and the test file section that covers
it (`test/whatsapp-location-contact.test.ts`, the `describe("a location pin", ...)`
block) before changing anything.

- [ ] **Step 2: Write the failing test**

Add to the existing `describe("a location pin", ...)` block in
`test/whatsapp-location-contact.test.ts`:

```ts
test("a dated pin lands in that date's own folder, not the flat bucket", async () => {
  const username = "loc2";
  await bindGreetAcknowledge(username, "+41000000004");
  writeTrip(username, "trip", "2026-01-01", "2026-01-31");
  await handleInboundMessage(locationMessage("+41000000004", "wamid.loc2.pin", "1767225600"));
  // 1767225600 = 2026-01-01T00:00:00Z.

  const { listInbox } = await import("@/lib/inbox");
  expect(listInbox(username).location).toHaveLength(0); // not in the flat bucket

  const { listDayInbox, readDayReadiness } = await import("@/lib/inbox");
  const dated = listDayInbox(username, "2026-01-01");
  expect(dated.location).toHaveLength(1);
  expect(dated.location[0].source).toBe("whatsapp");

  const readiness = readDayReadiness(username, "2026-01-01");
  expect(readiness.location?.source).toBe("whatsapp");
});
```

Note: `listDayInbox`/`readDayReadiness` are re-exported from `@/lib/inbox`
only if Task 1/2 chose to do so — check whether `lib/dayReadiness.ts`'s
`readDayReadiness` needs importing from its own module instead
(`@/lib/dayReadiness`) and fix the import in this test accordingly. Verify
against what Tasks 1 and 2 actually exported before trusting this snippet
verbatim.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/whatsapp-location-contact.test.ts`
Expected: FAIL — the pin still lands in the flat bucket.

- [ ] **Step 4: Change `handleLocationPin` to file dated**

The rewrite from Phase 1's Task 6 stores via `storeInboxFile(username, "location", ...)`
directly. Change it to store first (unchanged), then move the just-stored
file into the date folder and record the location on `day.json`:

```ts
async function handleLocationPin(
  username: string,
  locale: string,
  message: Extract<InboundMessage, { kind: "location" }>,
): Promise<void> {
  const { storeInboxFile, moveInboxFileToDay } = await import("../inbox");
  const { writeDayReadiness } = await import("../dayReadiness");
  const receivedAt = new Date((Number(message.timestamp) || Date.now() / 1000) * 1000);
  const date = receivedAt.toISOString().slice(0, 10);
  const { entry } = storeInboxFile(
    username,
    "location",
    `location-${message.timestamp}.json`,
    Buffer.from(JSON.stringify({ lat: message.latitude, lon: message.longitude })),
    { lat: message.latitude, lon: message.longitude, source: "whatsapp", receivedAt: receivedAt.toISOString() },
  );
  moveInboxFileToDay(username, entry.id, date);
  writeDayReadiness(username, date, { location: { lat: message.latitude, lon: message.longitude, source: "whatsapp" } });
  await sendServiceReply(message.from, translateIn(locale, "wa.locationSaved"), username);
}
```

Verify the real current function signature and imports (this is Phase 1's
already-merged code — read it fresh, do not assume the snippet above matches
line for line) before applying this change.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/whatsapp-location-contact.test.ts`
Expected: PASS

- [ ] **Step 6: Run the broader WhatsApp regression**

Run: `npx vitest run test/whatsapp-location-contact.test.ts test/whatsapp-new-chat.test.ts test/whatsapp-model-turn.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/whatsapp/dispatch.ts test/whatsapp-location-contact.test.ts
git commit -m "A WhatsApp location pin, already dated by its own message timestamp, files straight into that date's folder (SDD plan: inbox day-assembly Phase 2, Task 3)"
```

---

### Task 4: Surface the day folder in `/agent`'s inbox pane

**Files:**
- Modify: `components/HelperRoom.tsx` (or wherever `InboxFileGroups` is fed
  its data — read the current file first; Phase 1's Task 5 touched this
  exact area)
- Modify: `components/InboxFileGroups.tsx` (a new, optional grouping)
- Test: extend `test/inbox-file-groups.test.tsx` and `test/helper-room.test.tsx`

**Interfaces:**
- Consumes: `listDayInbox` (Task 1).
- Produces: nothing new consumed elsewhere — purely a rendering change.

**Why this task exists:** without it, a person watching the files pane after
a WhatsApp pin lands sees nothing move — Task 3 files the pin straight into a
date folder, invisible to `listInbox` (the flat-bucket read `HelperRoom.tsx`
currently uses). This task is deliberately small: it shows *that* dated
content exists for a date, grouped under that date's own heading, using the
same `InboxFileGroups` component Phase 1 already built rather than a second
one.

- [ ] **Step 1: Read the current wiring**

Read `components/HelperRoom.tsx`'s files pane in full (the section Phase 1's
Task 5 modified — search for `InboxFileGroups`) and read
`components/InboxFileGroups.tsx` in full. Note exactly how `InboxFile[]` is
built today from `listInbox(username)`'s flat-bucket read.

- [ ] **Step 2: Write the failing test**

Add to `test/helper-room.test.tsx` (reuse the existing `render()` harness and
`vi.stubGlobal("fetch", ...)` pattern):

```ts
test("a date with staged content shows its own heading in the files pane", async () => {
  // Stub the room's own status/inbox fetch to include one dated item —
  // read the current fetch-stubbing pattern in this file (search for how
  // `/api/helper/<user>/inbox` or the room's status endpoint is mocked
  // today) and match it. The new heading should read the date
  // ("2026-01-01") rather than "Other"/"Documents" — check
  // `components/InboxFileGroups.tsx`'s actual heading logic before writing
  // this assertion, since Task 3 (Phase 3's plan) is what actually visits
  // this pane end-to-end; this task only needs the heading to render.
});
```

This step is deliberately left to the implementer to write concretely
against the current fetch-stubbing pattern in `test/helper-room.test.tsx` —
the exact shape of the status/inbox response this component reads is likely
to have moved since this plan was written (Phase 1 alone touched this file
twice). Read the file fresh, find the real shape, and write a real assertion
matching it before proceeding; do not skip this step because the exact mock
shape is not given here.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/helper-room.test.tsx`
Expected: FAIL, or reveal that the current wiring has no path for dated
content at all yet (expected, since Task 4 has not wired one in).

- [ ] **Step 4: Add a dated-content read to the room's inbox fetch**

Wherever `HelperRoom.tsx` currently reads the flat inbox for the files pane,
add a parallel read of any date folders with content
(`fs.readdirSync(path.join(userDir, "inbox", "days"))`, filtering to
directories, then `listDayInbox` for each) — this likely belongs in
whatever server-side status/inbox route already feeds the room
(`app/api/helper/[user]/inbox/route.ts` or the room's own status endpoint —
find it first) rather than in the component itself, matching the existing
split between server-computed state and client rendering this codebase
already uses everywhere else.

Group dated entries under the date as `InboxFileGroups`' heading, reusing its
existing group-rendering shape (`photos`/`documents`/`other` from Phase 1's
Task 5) — add a fourth, date-keyed group per date with content, rendered
above the undated groups.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/helper-room.test.tsx test/inbox-file-groups.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add components/HelperRoom.tsx components/InboxFileGroups.tsx test/helper-room.test.tsx test/inbox-file-groups.test.tsx
git commit -m "Show a date's staged content under its own heading in the files pane (SDD plan: inbox day-assembly Phase 2, Task 4)"
```

---

## Final check

- [ ] Run `npm run verify` in full (build → tsc → eslint → vitest → knip).
- [ ] Confirm `content/<user>/inbox/days/` is covered by the existing
  gitignore rule for `content/<user>/inbox/` (it should be, as a
  subdirectory — check `.gitignore` and `lib/storageQuota.ts`'s "the whole of
  `content/<user>/`" accounting still counts it, which it does automatically
  since nothing excludes it).
- [ ] `test-in-a-browser`: sign in as an owner, send yourself (or simulate)
  a dated WhatsApp location pin locally, open `/agent`, and confirm the
  files pane shows a heading for that date. This is the one thing no test in
  this plan can check — Task 4's whole point is what a person sees.

## What Phase 3 needs from here, unchanged going forward

Phase 3's plan (not written yet) will read `readDayReadiness`,
`listDayInbox`, `readWords`, and will call `moveInboxFileToDay`/
`findDayInboxFile`/`removeDayInboxFile` when moving a day folder's content
into a real entry, then delete the day folder once nothing remains in it —
the day folder's job was staging, and once a real entry exists that is where
all of this lives, read the ordinary way from then on.
