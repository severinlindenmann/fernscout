# Camera Roll Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let somebody stand on a phone, pick a few hundred old photographs, and be guided — a day at a time, by voice or by typing — to a complete trip draft they then publish themselves.

**Architecture:** A holding area outside the journal (`$DATA_DIR/staging/`) takes the upload and never touches the storage quota; a run manifest on disk tracks what arrived and what the person has said about it; `clusterMedia` groups the photographs into days without writing anything; and when a day is confirmed the files move into the **existing** `inbox/days/<date>/` machinery so the already-built day-assembly path creates the draft. The new surface is a mobile-first owner page at `/<user>/extract`; nearly all of the back half already exists.

**Tech Stack:** Next 16 App Router, TypeScript, Vitest, filesystem state (no new tables), `sharp` for derivatives, the existing Anthropic + Deepgram helper paths, no new runtime dependency.

**Spec:** The visual draft published for this feature (v2, 15 Sep 2026) plus ticket `docs/tasks/backlog/big-feature/B1751-an-old-trip-that-exists-only.md`. Read `docs/superpowers/specs/2026-09-12-inbox-day-assembly-design.md` too — this plan is a front end onto that spec's Phases 2–3, which are already merged.

## Global Constraints

- **Nothing is invented.** No weather, place, person, meal or measurement the person or a file did not supply. A photograph with no EXIF location produces a day with no location. An empty field beats a plausible one.
- **Generate never publishes.** Every task here ends at `status: draft`. Publishing stays the separate, owner-only, explicitly-consented call it is today.
- **The capability is off by default** and must be *absent*, not broken, when disabled: `lib/capabilities.ts` decides and `/api/health` explains.
- **No paid provider account to develop or test.** The staging store's default driver is local disk. An object-storage driver is Phase 5, optional, and the local driver stays the tested one.
- **No new runtime dependency** without measured need. Nothing in Phases 0–4 adds one.
- **Owner pages use browser cookies; `/api/**` takes bearer tokens.** Every route here is an owner route and uses `isHelperOwner` — bearer refused, exactly like the rest of `app/api/helper/`.
- **Dialect stays inside `lib/db/`.** Nothing in this plan touches the database at all.
- **No `window.confirm`, `alert` or `prompt`.** Confirmations use `components/ConfirmPanel.tsx`.
- **Every new UI string needs real English, German and Hungarian** in `site/locales/`, then `npm run i18n:keys`. A language you cannot write is a task left short of done, not an invented translation.
- **Anything touching an API route or visibility goes through the security review path before merge** (`claude-security` over the branch).
- Final gate is `npm run verify` — build, tsc, eslint, vitest, knip, in that order. `VERIFY_WILL_WAIT=1` and a 900000 ms timeout; never background it.

---

## What already exists — read this before writing anything

More than half of this feature is built. The single largest risk in this plan is an implementer rebuilding one of these:

| Already there | Where | What it does |
| --- | --- | --- |
| Per-date staging folders | `lib/inbox.ts` — `dayInboxDir`, `listDayInbox`, `moveInboxFileToDay`, `moveInboxFileFromDay`, `updateInboxMeta` | `inbox/days/<date>/` with sidecars. The destination for a confirmed day. |
| Day readiness record | `lib/dayReadiness.ts` — `readDayReadiness`, `writeDayReadiness`, `readWords`, `appendWords` | `day.json` per date: declines, "nobody knows", a location with its source, the prose so far. |
| The missing-field registry | `lib/tracks.ts` — `TRACKS`, `missingFrom`, `declinesIn`, `UNKNOWN`, `TRACK_ROWS` | Three-answer fields (value / declined / nobody knows). **The chips in the design are this registry.** |
| What a day folder still lacks | `lib/dayMissing.ts` — `missingForDayFolder` | Exactly the question Step 06 of the design asks. |
| Day creation from a folder | `app/api/helper/[user]/assemble-day/route.ts` | Surveys a date folder and creates the draft once, not incrementally. |
| EXIF | `lib/ingest/exif.ts` — `readExif`, `photoMetaFromExif`, `isoDate`, `isoTime` | JPEG APP1, HEIC `meta`, WebP. GPS, capture time and offset, orientation, make/model. |
| Day clustering | `lib/ingest/cluster.ts` — `clusterMedia`, `fillMissingCoordinates` | Groups located media into days by time gap and distance. |
| Reverse geocoding | `lib/ingest/geo.ts` — `reverseGeocode`, `geodataAvailable` | Offline place index; degrades to no name. |
| Photo captions from a model | `app/api/helper/[user]/day/describe-photos/route.ts`, `lib/helper/credits.ts` — `creditsForPhotos`, `PHOTOS_PER_CREDIT = 10` | Returns suggestions, writes nothing. Sends a derivative, never an original. |
| Transcription | `app/api/helper/[user]/transcribe/route.ts`, `lib/helper/transcribe.ts`, `lib/helper/transcribeSpend.ts` | Voice note to text, already metered. |
| Credits | `lib/credits.ts` — `spend(owner, n, reason, ref)`, `refund`, `balanceOf`, `creditsEnabled` | Hundredths precision. Refuses when there is no database. |
| Quota | `lib/storageQuota.ts` — `withStorageQuota`, `storageRefusal`, `journalBytes` | Counts `content/<user>` only. **This is why staging lives outside it.** |
| Trip people | `app/api/helper/[user]/trip/people/route.ts` | The travellers list Step 08 writes. |
| Weather lookup | `lib/api/weather.ts` — `fillDayWeatherQuietly` | Real archive reading once place and date are known. |
| Confirm UI | `components/ConfirmPanel.tsx` | The only confirmation pattern allowed. |

## Decisions taken in this plan

1. **The flow lives at `/<user>/extract`, not `/extract`.** A top-level `/extract` shadows a username and would need a permanent entry in `ALWAYS_RESERVED` (`lib/users.ts:45`) for a per-journal feature. The owner-cookie auth, the capability check and the storage numbers are all per-journal anyway. Changing it later is one directory move.
2. **The guide half lives at `/docs/extract`.** `docs` is already reserved, already has a nav, and the deliverable is words somebody reads. It is Phase 4 and independent of everything else.
3. **No database.** The run manifest is a JSON file beside the staged bytes, the same way the inbox uses sidecars. A run is short-lived by definition; a table would outlive its subject.
4. **Staging is `$DATA_DIR/staging/<user>/<runId>/`** — `dataDir()` from `lib/dataDir.ts`, deliberately *not* under `userDir(username)`, because `journalBytes` walks that and the whole point is to stay out of the quota.
5. **Object storage is Phase 5 and optional.** Severin chose S3-compatible storage with lifecycle rules for the TTL. Honoured — but as a second driver behind the same interface, with the local driver remaining the default and the tested one, because AGENTS.md forbids a feature that needs a paid account to develop. Phases 0–4 ship without it.
6. **Videos are accepted and staged, but contribute no location** until B1755 lands. Say so in the UI rather than silently dropping them.

## Expiry, warning and the one extension — decided 2026-09-15 by the owner

A run is not simply deleted at 48 hours. The rule, in full, because three
tasks depend on getting it exactly right:

| | |
| --- | --- |
| A new run expires at | `createdAt + 48h` |
| A nightly sweep warns | any run with no `warnedAt` once it is **24 hours old** |
| Sending that warning **pins** expiry to | `warnedAt + 24h` |
| Continuing the run after the warning extends it, **once**, to | `now + 48h`, and sets `extendedAt` |
| A run already extended gets | one final notice, with no offer, and then goes |
| Credits spent on a run that expires are | **gone. No refund, and nothing is preserved.** |

**Why the warning pins the deadline.** The sweep runs nightly, beside the
currency refresh in `scripts/backup.sh`, so "24 hours old" is really "24 to 48
hours old depending on when they uploaded". If the mail promised 24 hours
against a fixed `createdAt + 48h`, somebody who uploaded at four in the morning
would get a mail saying 24 hours that meant one. Setting `expiresAt =
warnedAt + 24h` when the warning goes out makes the sentence in the mail true
by construction, whatever the cron jitter, at the cost of an effective TTL
between 48 and 72 hours. That is the right trade: the promise is to a person,
the jitter is ours.

**Continuing *is* the extension.** There is no "extend" button. Any
authenticated touch of the run — opening it, answering a question, uploading
more — extends it if it has not been extended already. A button would be a
second way to say the thing they just did by arriving.

**No refund, and therefore three places have to say so** (owner, 2026-09-15).
Enrichment is generated into the run. If the run expires, the output goes with
the staged files and the credits stay spent. That is a defensible rule — the
work was done, the model was paid for — but it is only defensible if nobody
meets it as a surprise, so it is written in three places and each of them is a
requirement, not a nicety:

1. **Before the spend** (Task 4.1) — on the credits screen, above the button.
2. **In the warning** (Task 0.5) — naming the actual number of credits already
   spent on this run, not a general caution.
3. **In the final notice** (Task 0.5) — the same number, last chance.

A person who has spent thirty credits and gets a mail that does not mention
them has been told the least important half of what is about to happen.

**The second notice is my call, not the owner's** (recorded here so the next
reader can tell the two apart). The owner specified the first warning and the
single extension. A run that has been extended still ends, and ending in
silence after somebody was once told they would be warned reads as a bug; so
it gets one final notice that says plainly there is no further extension. If
that is unwanted it is a four-line deletion in `lib/staging/expiry.ts`.

---

## File structure

**New — the staging store (Phase 0)**
- `lib/staging/paths.ts` — where a run's bytes and manifest live. One responsibility: path arithmetic, no I/O.
- `lib/staging/store.ts` — put, read, list, remove a staged file. The driver seam.
- `lib/staging/sweep.ts` — delete runs past their TTL.
- `lib/staging/manifest.ts` — the run record: read, write, and the types every later phase speaks.
- `lib/staging/expiry.ts` — the warn / pin / extend rules, and the nightly sweep that applies them.
- `scripts/extract-remind.mts` — the nightly door onto it, beside `scripts/reminders.mts`.

**New — the import run (Phases 1–3)**
- `lib/extract/analyse.ts` — EXIF out of staged bytes into manifest rows.
- `lib/extract/group.ts` — manifest rows into day groups via `clusterMedia`.
- `lib/extract/questions.ts` — which questions a day still needs, and their exact wording.
- `lib/extract/commit.ts` — a confirmed day's files into `inbox/days/<date>/` and on to `assemble-day`.

**New — routes (all owner-cookie, all under the existing helper prefix)**
- `app/api/helper/[user]/extract/start/route.ts`
- `app/api/helper/[user]/extract/upload/route.ts`
- `app/api/helper/[user]/extract/run/route.ts` — GET the manifest, PATCH one photograph's fields
- `app/api/helper/[user]/extract/day/route.ts` — answer a day's questions
- `app/api/helper/[user]/extract/commit/route.ts`
- `app/api/helper/[user]/extract/runs/route.ts` — list live runs, for resume
- `app/api/helper/[user]/extract/sample/route.ts` — the one free description

**New — UI**
- `app/[user]/extract/page.tsx` — the shell; capability gate and owner gate.
- `components/extract/ExtractFlow.tsx` — the state machine the design's phases map onto.
- `components/extract/UploadStep.tsx` — per-file tiles, retry, wake lock.
- `components/extract/DayBoard.tsx` — the workspace (Step 05).
- `components/extract/PhotoChips.tsx` — the chip row (Step 06).
- `components/extract/AskCard.tsx` — one question, voice or typed (Step 07).

**Modified**
- `lib/config.ts:18` — add `"extract"` to `FEATURE_NAMES`.
- `lib/capabilities.ts:31` — add its `REQUIREMENTS` row.
- `deploy/fernscout.caddy:80` — add the upload path to `@bigbody`, remove it from `@smallbody`.
- `scripts/backup.sh:477` — run the reminder sweep nightly, beside `reminders:send`.
- `package.json` — an `extract:remind` script, the same shape as `reminders:send`.
- `site/locales/{en,de,hu}.json` — every string.

**Tests**
- `test/staging-store.test.ts`, `test/staging-sweep.test.ts`, `test/staging-expiry.test.ts`, `test/extract-analyse.test.ts`, `test/extract-group.test.ts`, `test/extract-questions.test.ts`, `test/extract-commit.test.ts`, `test/extract-routes.test.ts`, `test/extract-capability.test.ts`

---

# Phase 0 — the holding area

Ships: bytes can be staged outside the quota and disappear on time. No UI.

### Task 0.1: The capability

**Files:**
- Modify: `lib/config.ts:18-50`
- Modify: `lib/capabilities.ts:31`
- Test: `test/extract-capability.test.ts`

**Interfaces:**
- Produces: the feature name `"extract"`, usable as `isEnabled("extract", username)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { FEATURE_NAMES } from "@/lib/config";
import { isEnabled } from "@/lib/capabilities";

describe("the extract capability", () => {
  test("is a feature name", () => {
    expect(FEATURE_NAMES).toContain("extract");
  });

  test("is off when nothing has enabled it", () => {
    expect(isEnabled("extract", "nobody")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/extract-capability.test.ts`
Expected: FAIL — `expected [ ... ] to contain 'extract'`.

- [ ] **Step 3: Add the name**

In `lib/config.ts`, after `"transcription",`:

```ts
  // B1751. The guided camera-roll import. Separate from `helper` because it
  // has a different cost shape — it stages hundreds of megabytes outside the
  // quota — and a journal may want the helper without ever importing an old
  // trip.
  "extract",
```

- [ ] **Step 4: Add the requirement row**

In `lib/capabilities.ts`, inside `REQUIREMENTS`:

```ts
  // Needs somebody to be signed in as, and the helper because every question
  // this asks is a helper turn. Transcription is deliberately *not* required —
  // without it the flow is the typing one, which is a whole feature rather
  // than a broken one.
  extract: {
    env: ["SESSION_SECRET"],
    db: false,
    needs: {
      auth: "somebody has to be signed in to import into their own journal",
      helper: "the questions this asks are helper turns",
    },
  },
```

- [ ] **Step 5: Run the test, and the health route's own test with it**

Run: `npx vitest run test/extract-capability.test.ts test/health.test.ts`
Expected: PASS. If `test/health.test.ts` asserts a fixed capability list, update that list — it is a keeper whose contract this task legitimately changes, which is different from weakening one.

- [ ] **Step 6: Commit**

```bash
git add lib/config.ts lib/capabilities.ts test/extract-capability.test.ts
git commit -m "feat: an extract capability, off by default"
```

### Task 0.2: Staging paths and the store

**Files:**
- Create: `lib/staging/paths.ts`, `lib/staging/store.ts`
- Test: `test/staging-store.test.ts`

**Interfaces:**
- Consumes: `dataDir()` from `lib/dataDir.ts`.
- Produces:
  - `stagingRoot(): string`
  - `runDir(username: string, runId: string): string`
  - `newRunId(now: Date): string`
  - `putStagedFile(username: string, runId: string, filename: string, bytes: Buffer): StagedFile` where `type StagedFile = { id: string; filename: string; bytes: number; sha256: string }`
  - `readStagedFile(username: string, runId: string, id: string): Buffer | null`
  - `removeRun(username: string, runId: string): void`
  - `runBytes(username: string, runId: string): number`

- [ ] **Step 1: Write the failing test**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-staging-"));
  process.env.DATA_DIR = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

describe("the staging store", () => {
  test("keeps bytes outside the journal", async () => {
    const { putStagedFile, readStagedFile } = await import("@/lib/staging/store");
    const stored = putStagedFile("alex", "run-1", "IMG_0001.jpeg", Buffer.from("hello"));
    expect(stored.bytes).toBe(5);
    expect(readStagedFile("alex", "run-1", stored.id)?.toString()).toBe("hello");
    // Nothing was written anywhere a quota walk would find it.
    expect(fs.existsSync(path.join(tmp, "content", "alex"))).toBe(false);
  });

  test("the same bytes twice are one file", async () => {
    const { putStagedFile, runBytes } = await import("@/lib/staging/store");
    const a = putStagedFile("alex", "run-1", "IMG_0001.jpeg", Buffer.from("hello"));
    const b = putStagedFile("alex", "run-1", "IMG_0001.jpeg", Buffer.from("hello"));
    expect(b.id).toBe(a.id);
    expect(runBytes("alex", "run-1")).toBe(5);
  });

  test("a run id refuses a path separator", async () => {
    const { readStagedFile } = await import("@/lib/staging/store");
    expect(() => readStagedFile("alex", "../../etc", "x")).toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/staging-store.test.ts`
Expected: FAIL — `Cannot find module '@/lib/staging/store'`.

- [ ] **Step 3: Write `lib/staging/paths.ts`**

```ts
import path from "node:path";
import { dataDir } from "@/lib/dataDir";

/**
 * Where an import run's bytes sit while somebody is still deciding about them.
 *
 * **Deliberately not under `userDir(username)`.** `journalBytes` in
 * lib/storageQuota.ts walks that directory, and a holding area that counted
 * against the quota would refuse the very upload this feature exists to
 * accept. Out here, three hundred photographs cost the journal nothing until
 * the days they belong to are confirmed.
 */
export function stagingRoot(): string {
  return path.join(dataDir(), "staging");
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** A path segment that cannot climb out of the staging root.
 *  Thrown rather than sanitised: a caller handing this a traversal is a bug in
 *  the caller, and quietly rewriting it hides that. */
function segment(value: string, what: string): string {
  if (!SEGMENT.test(value)) throw new Error(`${what} is not a usable name: ${JSON.stringify(value)}`);
  return value;
}

export function runDir(username: string, runId: string): string {
  return path.join(stagingRoot(), segment(username, "username"), segment(runId, "run id"));
}

/** Sortable, unique enough, and readable in a directory listing. No randomness
 *  — the instant is all a single-owner run needs, and `Math.random()` is
 *  unavailable in some of the contexts this ends up running in. */
export function newRunId(now: Date): string {
  return `run-${now.toISOString().replace(/[:.]/g, "-")}`;
}
```

- [ ] **Step 4: Write `lib/staging/store.ts`**

```ts
import "server-only";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runDir } from "./paths";

export type StagedFile = {
  /** Content-addressed, so the same photograph sent twice is stored once. */
  id: string;
  filename: string;
  bytes: number;
  sha256: string;
};

/** The id is the hash plus the extension, for the same reason `inboxId` does
 *  it: a retried half-finished batch must not double the run. */
function idFor(filename: string, sha: string): string {
  const ext = path.extname(filename).toLowerCase().replace(/[^.a-z0-9]/g, "");
  return `${sha.slice(0, 32)}${ext}`;
}

export function putStagedFile(
  username: string,
  runId: string,
  filename: string,
  bytes: Buffer,
): StagedFile {
  const sha = createHash("sha256").update(bytes).digest("hex");
  const id = idFor(filename, sha);
  const dir = path.join(runDir(username, runId), "files");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, id);
  if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);
  return { id, filename, bytes: bytes.byteLength, sha256: sha };
}

export function readStagedFile(username: string, runId: string, id: string): Buffer | null {
  // `runDir` validates the two segments and throws; `basename` is what stops
  // the third. A caller that has been handed an id from a manifest cannot
  // reach outside the run, and one that made an id up gets null.
  const file = path.join(runDir(username, runId), "files", path.basename(id));
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

export function removeRun(username: string, runId: string): void {
  fs.rmSync(runDir(username, runId), { recursive: true, force: true });
}

export function runBytes(username: string, runId: string): number {
  const dir = path.join(runDir(username, runId), "files");
  let total = 0;
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    if (name.isFile()) total += fs.statSync(path.join(dir, name.name)).size;
  }
  return total;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/staging-store.test.ts`
Expected: PASS, all three.

- [ ] **Step 6: Commit**

```bash
git add lib/staging test/staging-store.test.ts
git commit -m "feat: a staging store that sits outside the storage quota"
```

### Task 0.3: The manifest

**Files:**
- Create: `lib/staging/manifest.ts`
- Test: `test/staging-store.test.ts` (extend)

**Interfaces:**
- Consumes: `runDir`, `stagingRoot` from `lib/staging/paths.ts`.
- Produces — every later phase speaks these types, so they are defined once, here:

```ts
export type PhotoRow = {
  id: string;
  filename: string;
  bytes: number;
  kind: "image" | "video";
  /** Read from the file. Absent means absent — never a fallback, never a guess. */
  takenAt?: string;      // "2019-07-02T10:07:05", wall clock, no zone
  offset?: string;       // "+07:00"
  lat?: number;
  lng?: number;
  make?: string;
  model?: string;
  /** Set by the person, in the flow. */
  date?: string;         // "2019-07-02" — which day this belongs to
  caption?: string;
  visibility?: "guest" | "private";
  dropped?: boolean;
};

export type DayRow = {
  date: string;
  words?: string;
  location?: string;
  /** Answered question ids, so the flow never asks the same thing twice. */
  answered: string[];
  committed?: boolean;
};

export type RunManifest = {
  version: 1;
  runId: string;
  owner: string;
  createdAt: string;
  expiresAt: string;
  /** null means "a new trip, named at the end". */
  tripId: string | null;
  mode: "voice" | "type";
  state: "uploading" | "analysed" | "telling" | "committed";
  photos: PhotoRow[];
  days: DayRow[];
  /** Set once the one free sample description has been taken. */
  sampleTakenFor?: string;
  /** When the "24 hours left" notice went out. Its presence is what stops a
   *  second one, and writing it also pins `expiresAt` to 24h later. */
  warnedAt?: string;
  /** When continuing the run bought it another 48 hours. Once only — its
   *  presence is the whole of that rule. */
  extendedAt?: string;
};

export function readManifest(username: string, runId: string): RunManifest | null;
export function writeManifest(username: string, m: RunManifest): void;
export function listRuns(username: string): RunManifest[];
```

- [ ] **Step 1: Write the failing test**

Append to `test/staging-store.test.ts`:

```ts
describe("the run manifest", () => {
  test("round-trips, and a missing run reads as null", async () => {
    const { writeManifest, readManifest } = await import("@/lib/staging/manifest");
    expect(readManifest("alex", "run-none")).toBeNull();
    writeManifest("alex", {
      version: 1,
      runId: "run-1",
      owner: "alex",
      createdAt: "2026-09-15T10:00:00Z",
      expiresAt: "2026-09-17T10:00:00Z",
      tripId: null,
      mode: "voice",
      state: "uploading",
      photos: [{ id: "a.jpeg", filename: "IMG_1.jpeg", bytes: 5, kind: "image" }],
      days: [],
    });
    expect(readManifest("alex", "run-1")?.photos[0].filename).toBe("IMG_1.jpeg");
  });

  test("a corrupt manifest reads as null rather than throwing", async () => {
    const { readManifest } = await import("@/lib/staging/manifest");
    const { runDir } = await import("@/lib/staging/paths");
    fs.mkdirSync(runDir("alex", "run-bad"), { recursive: true });
    fs.writeFileSync(path.join(runDir("alex", "run-bad"), "run.json"), "{ not json");
    expect(readManifest("alex", "run-bad")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/staging-store.test.ts`
Expected: FAIL — `Cannot find module '@/lib/staging/manifest'`.

- [ ] **Step 3: Write the module**

```ts
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { runDir, stagingRoot } from "./paths";

// … the exported types above, verbatim …

function manifestPath(username: string, runId: string): string {
  return path.join(runDir(username, runId), "run.json");
}

/**
 * A run that is missing, unreadable or malformed reads as `null`.
 *
 * The same stance `readDayReadiness` takes for `day.json`: this file is on
 * disk, a person may have been editing around it, and an exception here would
 * take out a page rather than one run. The caller's answer to `null` is always
 * "start again", which is the correct answer to all three causes.
 */
export function readManifest(username: string, runId: string): RunManifest | null {
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath(username, runId), "utf8")) as RunManifest;
    return raw && raw.version === 1 ? raw : null;
  } catch {
    return null;
  }
}

/** Written through a temp file and renamed: a phone that drops mid-write must
 *  not leave half a manifest, which would read as a run with no photographs in
 *  it and lose the lot. */
export function writeManifest(username: string, m: RunManifest): void {
  const dir = runDir(username, m.runId);
  fs.mkdirSync(dir, { recursive: true });
  const target = manifestPath(username, m.runId);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(m, null, 2));
  fs.renameSync(tmp, target);
}

export function listRuns(username: string): RunManifest[] {
  const dir = path.join(stagingRoot(), username);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((runId) => readManifest(username, runId))
    .filter((m): m is RunManifest => m !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/staging-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/staging/manifest.ts test/staging-store.test.ts
git commit -m "feat: the import run manifest"
```

### Task 0.4: The sweep

**Files:**
- Create: `lib/staging/sweep.ts`
- Test: `test/staging-sweep.test.ts`

**Interfaces:**
- Consumes: `readManifest`, `runDir`, `stagingRoot`, `removeRun`.
- Produces: `export const RUN_TTL_MS = 48 * 60 * 60 * 1000;` and `export function sweepStaging(now: Date): { removed: string[] }`.

- [ ] **Step 1: Write the failing test**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-sweep-"));
  process.env.DATA_DIR = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

async function makeRun(runId: string, expiresAt: string) {
  const { writeManifest } = await import("@/lib/staging/manifest");
  const { putStagedFile } = await import("@/lib/staging/store");
  putStagedFile("alex", runId, "a.jpeg", Buffer.from(runId));
  writeManifest("alex", {
    version: 1, runId, owner: "alex",
    createdAt: "2026-09-13T10:00:00Z", expiresAt,
    tripId: null, mode: "type", state: "uploading", photos: [], days: [],
  });
}

describe("the staging sweep", () => {
  test("removes an expired run and leaves a live one", async () => {
    await makeRun("run-old", "2026-09-14T10:00:00Z");
    await makeRun("run-new", "2026-09-17T10:00:00Z");
    const { sweepStaging } = await import("@/lib/staging/sweep");
    const { runDir } = await import("@/lib/staging/paths");

    const result = sweepStaging(new Date("2026-09-15T12:00:00Z"));

    expect(result.removed).toEqual(["run-old"]);
    expect(fs.existsSync(runDir("alex", "run-old"))).toBe(false);
    expect(fs.existsSync(runDir("alex", "run-new"))).toBe(true);
  });

  test("a run whose manifest is unreadable is still removed once it is older than the ttl", async () => {
    const { runDir } = await import("@/lib/staging/paths");
    const dir = runDir("alex", "run-broken");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "run.json"), "{ not json");
    fs.utimesSync(dir, new Date("2026-09-10T00:00:00Z"), new Date("2026-09-10T00:00:00Z"));

    const { sweepStaging } = await import("@/lib/staging/sweep");
    sweepStaging(new Date("2026-09-15T12:00:00Z"));

    expect(fs.existsSync(dir)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/staging-sweep.test.ts`
Expected: FAIL — `Cannot find module '@/lib/staging/sweep'`.

- [ ] **Step 3: Write the module**

```ts
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { readManifest } from "./manifest";
import { runDir, stagingRoot } from "./paths";
import { removeRun } from "./store";

/** Two days. Long enough to do this over an evening and the next one, short
 *  enough that somebody's whole camera roll is not sitting on a server they
 *  have forgotten about. **Stated to the person on the resume screen** — a
 *  clock nobody is told about is one they discover by losing something. */
export const RUN_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * Delete every run past its own `expiresAt`.
 *
 * A run whose manifest will not parse has no `expiresAt` to honour, so it
 * falls back to the directory's own mtime against `RUN_TTL_MS`. Without that
 * branch, one unreadable manifest pins somebody's photographs on disk forever
 * — which is the single outcome this file exists to prevent.
 */
export function sweepStaging(now: Date): { removed: string[] } {
  const removed: string[] = [];
  let owners: string[];
  try {
    owners = fs.readdirSync(stagingRoot());
  } catch {
    return { removed };
  }
  for (const owner of owners) {
    let runs: string[];
    try {
      runs = fs.readdirSync(path.join(stagingRoot(), owner));
    } catch {
      continue;
    }
    for (const runId of runs) {
      const manifest = readManifest(owner, runId);
      const expired = manifest
        ? manifest.expiresAt <= now.toISOString()
        : now.getTime() - safeMtime(owner, runId) > RUN_TTL_MS;
      if (!expired) continue;
      removeRun(owner, runId);
      removed.push(runId);
    }
  }
  return { removed };
}

function safeMtime(owner: string, runId: string): number {
  try {
    return fs.statSync(runDir(owner, runId)).mtimeMs;
  } catch {
    return 0;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/staging-sweep.test.ts`
Expected: PASS, both.

- [ ] **Step 5: Note where it gets called — no scheduler**

`sweepStaging` is called at the top of `extract/start` (Task 1.2) and nowhere else in Phases 0–4. A run nobody returns to is cleared by the next person who starts one, and on a one-owner instance that is the same person. A timer for a feature this size would be a second moving part with its own failure mode.

- [ ] **Step 6: Commit**

```bash
git add lib/staging/sweep.ts test/staging-sweep.test.ts
git commit -m "feat: sweep staged runs at 48 hours"
```

### Task 0.5: The warning, the pin, and the one extension

**Files:**
- Create: `lib/staging/expiry.ts`, `scripts/extract-remind.mts`
- Modify: `package.json`, `scripts/backup.sh:477`
- Test: `test/staging-expiry.test.ts`

**Interfaces:**
- Consumes: `listRuns`, `writeManifest`, `RunManifest`; `sendReminderMail`-shaped helpers from `lib/digest/reminder.ts` — **read that file and reuse its channel picker rather than writing a second one**; it already knows mail from WhatsApp and already fails soft when a channel is off.
- Produces:

```ts
export const WARN_AFTER_MS = 24 * 60 * 60 * 1000;
export const WARNED_GRACE_MS = 24 * 60 * 60 * 1000;
export const EXTENSION_MS = 48 * 60 * 60 * 1000;

/** What a nightly pass should do with one run. Pure, so it can be tested
 *  without a mailer, a clock or a filesystem. */
export type ExpiryAction =
  | { do: "nothing" }
  | { do: "warn"; expiresAt: string; hoursLeft: number; canExtend: boolean }
  | { do: "final-notice"; expiresAt: string };

export function expiryActionFor(run: RunManifest, now: Date): ExpiryAction;

/** Continuing a run is the extension. Returns the manifest to write, or null
 *  when nothing changed — so a caller can skip the write. */
export function extendOnTouch(run: RunManifest, now: Date): RunManifest | null;

/** The nightly pass. Sends, stamps and writes. */
export function sweepExpiryWarnings(now: Date, opts: { dryRun: boolean }): Promise<{ warned: string[]; finalNotices: string[] }>;
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import {
  EXTENSION_MS, expiryActionFor, extendOnTouch,
} from "@/lib/staging/expiry";
import type { RunManifest } from "@/lib/staging/manifest";

const run = (over: Partial<RunManifest> = {}): RunManifest => ({
  version: 1, runId: "run-1", owner: "alex",
  createdAt: "2026-09-15T04:00:00Z",
  expiresAt: "2026-09-17T04:00:00Z",
  tripId: null, mode: "type", state: "telling", photos: [], days: [], ...over,
});

describe("when a run is warned", () => {
  test("nothing happens in the first 24 hours", () => {
    expect(expiryActionFor(run(), new Date("2026-09-15T23:00:00Z")).do).toBe("nothing");
  });

  test("past 24 hours old it warns, and offers the extension", () => {
    const action = expiryActionFor(run(), new Date("2026-09-16T05:00:00Z"));
    expect(action).toMatchObject({ do: "warn", hoursLeft: 24, canExtend: true });
  });

  test("the warning pins expiry to exactly 24 hours after the warning, not to createdAt + 48h", () => {
    // Uploaded at 04:00, nightly pass at 03:00 the next night: 23 hours of the
    // original 48 are left. Without the pin the mail would promise 24 and mean
    // 23; with it, the promise is true.
    const action = expiryActionFor(run(), new Date("2026-09-16T03:00:00Z"));
    expect(action).toMatchObject({ do: "warn" });
    if (action.do !== "warn") throw new Error("unreachable");
    expect(action.expiresAt).toBe("2026-09-17T03:00:00.000Z");
    expect(action.hoursLeft).toBe(24);
  });

  test("a warned run is never warned twice", () => {
    const warned = run({ warnedAt: "2026-09-16T03:00:00Z", expiresAt: "2026-09-17T03:00:00Z" });
    expect(expiryActionFor(warned, new Date("2026-09-16T23:00:00Z")).do).toBe("nothing");
  });
});

describe("when a run is continued", () => {
  test("continuing after the warning buys 48 hours, once", () => {
    const warned = run({ warnedAt: "2026-09-16T03:00:00Z", expiresAt: "2026-09-17T03:00:00Z" });
    const now = new Date("2026-09-16T20:00:00Z");
    const extended = extendOnTouch(warned, now);
    expect(extended?.expiresAt).toBe(new Date(now.getTime() + EXTENSION_MS).toISOString());
    expect(extended?.extendedAt).toBe(now.toISOString());
    // A second touch changes nothing at all.
    expect(extendOnTouch(extended!, new Date("2026-09-17T09:00:00Z"))).toBeNull();
  });

  test("continuing before any warning changes nothing — the 48 hours are still running", () => {
    expect(extendOnTouch(run(), new Date("2026-09-15T10:00:00Z"))).toBeNull();
  });

  test("an extended run gets one final notice and no second offer", () => {
    const extended = run({
      warnedAt: "2026-09-16T03:00:00Z",
      extendedAt: "2026-09-16T20:00:00Z",
      expiresAt: "2026-09-18T20:00:00Z",
    });
    const action = expiryActionFor(extended, new Date("2026-09-17T21:00:00Z"));
    expect(action).toMatchObject({ do: "final-notice" });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/staging-expiry.test.ts`
Expected: FAIL — `Cannot find module '@/lib/staging/expiry'`.

- [ ] **Step 3: Write the pure half**

```ts
import type { RunManifest } from "./manifest";

/** How old a run has to be before the notice goes out. */
export const WARN_AFTER_MS = 24 * 60 * 60 * 1000;
/** What the notice promises, and therefore what it pins. */
export const WARNED_GRACE_MS = 24 * 60 * 60 * 1000;
/** What continuing buys, once. */
export const EXTENSION_MS = 48 * 60 * 60 * 1000;

export type ExpiryAction =
  | { do: "nothing" }
  | { do: "warn"; expiresAt: string; hoursLeft: number; canExtend: boolean }
  | { do: "final-notice"; expiresAt: string };

/**
 * What tonight's pass should do with one run.
 *
 * **The warning pins the deadline, and that is the whole point of this
 * function.** The sweep runs nightly, so "24 hours old" is in practice
 * anywhere from 24 to 48 hours old — and a mail that says "24 hours left"
 * against a fixed `createdAt + 48h` would be telling somebody who uploaded at
 * four in the morning that they had a day when they had an hour. Writing
 * `expiresAt = warnedAt + 24h` makes the sentence true by construction. The
 * cost is an effective TTL between 48 and 72 hours, which is the right way
 * round: the promise is to a person, the jitter is ours.
 *
 * Pure on purpose — no clock, no mailer, no filesystem — because every rule
 * worth arguing about lives in here and a test should be able to reach it
 * without standing up any of that.
 */
export function expiryActionFor(run: RunManifest, now: Date): ExpiryAction {
  const ms = now.getTime();
  if (run.state === "committed") return { do: "nothing" };

  if (!run.warnedAt) {
    if (ms - Date.parse(run.createdAt) < WARN_AFTER_MS) return { do: "nothing" };
    return {
      do: "warn",
      expiresAt: new Date(ms + WARNED_GRACE_MS).toISOString(),
      hoursLeft: WARNED_GRACE_MS / 3_600_000,
      canExtend: true,
    };
  }

  // Warned, extended, and now inside the last day of the extension: one final
  // notice, with nothing to offer. My call rather than the owner's — see the
  // decision table above. Ending in silence after somebody was told they would
  // be warned reads as a bug.
  if (run.extendedAt && !run.finalNoticeAt && Date.parse(run.expiresAt) - ms <= WARNED_GRACE_MS) {
    return { do: "final-notice", expiresAt: run.expiresAt };
  }

  return { do: "nothing" };
}

/**
 * Continuing a run is the extension — there is no button.
 *
 * Any authenticated touch calls this: opening the run, answering a question,
 * uploading more. Before the warning it does nothing, because the original 48
 * hours are still running and extending an unwarned run would quietly make the
 * TTL unbounded for anybody who kept the tab open. After the warning, once.
 *
 * Returns `null` when nothing changed, so the caller can skip the write rather
 * than rewriting the manifest on every request.
 */
export function extendOnTouch(run: RunManifest, now: Date): RunManifest | null {
  if (!run.warnedAt || run.extendedAt) return null;
  return {
    ...run,
    extendedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + EXTENSION_MS).toISOString(),
  };
}
```

Add `finalNoticeAt?: string;` to `RunManifest` in `lib/staging/manifest.ts` beside `warnedAt` and `extendedAt`, with the comment: *"Set once the last notice has gone out, so an extended run cannot be told twice."*

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/staging-expiry.test.ts`
Expected: PASS, all six.

- [ ] **Step 5: Write the sweep and its script**

`sweepExpiryWarnings` walks `listRuns` for every owner, calls `expiryActionFor`, sends through `lib/digest/reminder.ts`'s channel picker, and writes the stamp. `--dry-run` sends nothing **and stamps nothing** — running it again afterwards must behave as though the dry run never happened, which is the contract `scripts/reminders.mts`, `notify.mts` and `rates-refresh.mts` all already keep. Do not break the set.

The two messages, in three languages, in `site/locales/`:

```json
"extract.expiry.warn.subject": "Your photo import has 24 hours left",
"extract.expiry.warn.body": "You started importing {count} photographs on {started} and there are {days} days still to tell. They'll be deleted in 24 hours — unless you carry on now, which gives you another two days. Days you've already finished are part of your journal and stay.",
"extract.expiry.spent": "You've spent {credits} credits on this import. If it's deleted, that work goes with it and the credits aren't returned.",
"extract.expiry.final.subject": "Your photo import is about to be deleted",
"extract.expiry.final.body": "The {count} photographs you haven't used yet go in 24 hours. This is the last notice — there's no further extension. Days you've already finished are part of your journal and stay."
```

Both say the same true thing twice: **what was already committed is safe.** A person reading "will be deleted" about their camera roll needs that sentence in the first paragraph, not the third.

`extract.expiry.spent` is appended to **both** messages, and only when the run has actually cost something. Read the number from the ledger — `spentByReason(owner)` filtered to this run's `ref`, never a number carried on the manifest, because the ledger is the truth about money and a second copy of it drifts. A run that cost nothing gets no sentence about credits; a caution about money nobody spent is noise that trains people to skim the rest.

- [ ] **Step 6: Wire it into the nightly run**

`package.json`:

```json
"extract:remind": "tsx --conditions=react-server scripts/extract-remind.mts"
```

`scripts/backup.sh`, immediately after the `reminders:send` block at line 477, in the same shape — it already reports its own failures, which is why this goes there rather than into a new timer:

```bash
if (cd "$APP_DIR" && npm run --silent extract:remind); then
```

- [ ] **Step 7: Call `extendOnTouch` from the run routes**

In `app/api/helper/[user]/extract/run/route.ts` (GET and PATCH), `day/route.ts` and `upload/route.ts`, after reading the manifest and before using it:

```ts
const extended = extendOnTouch(manifest, new Date());
if (extended) writeManifest(user, extended);
```

Four call sites, one shared function — the same shape the rest of this repository uses for a rule that must not be re-answered per caller. A fifth route added later that forgets this only fails to extend; it cannot extend twice.

- [ ] **Step 8: Run the whole staging suite**

Run: `npx vitest run test/staging-store.test.ts test/staging-sweep.test.ts test/staging-expiry.test.ts`
Expected: PASS.

- [ ] **Step 9: Prove the mail actually sends, locally**

Local mail goes to a file, not a provider (`features.mail.keepCopy`). Create a run, backdate its `createdAt` by 25 hours, run `npm run extract:remind`, and read the `.eml` that lands. Check the sentence about the extension is there and the number of hours is 24. Prose claiming a mail was sent is not evidence; the file is.

- [ ] **Step 10: Commit**

```bash
git add lib/staging/expiry.ts scripts/extract-remind.mts scripts/backup.sh package.json site/locales test/staging-expiry.test.ts
git commit -m "feat: warn 24 hours before a staged run goes, and let continuing extend it once"
```

---

# Phase 1 — upload and analyse

Ships: a phone can send photographs and get back what they knew about themselves. No day flow yet.

### Task 1.1: EXIF into manifest rows

**Files:**
- Create: `lib/extract/analyse.ts`
- Test: `test/extract-analyse.test.ts`

**Interfaces:**
- Consumes: `readExif`, `isoDate`, `isoTime` from `lib/ingest/exif.ts`; `VIDEO_EXTENSIONS` from `lib/ingest/video.ts`; `PhotoRow` from `lib/staging/manifest.ts`.
- Produces: `export function analyseStaged(row: Pick<PhotoRow, "id" | "filename" | "bytes">, bytes: Buffer): PhotoRow`

- [ ] **Step 1: Write the failing test**

```ts
import fs from "node:fs";
import { describe, expect, test } from "vitest";
import { analyseStaged } from "@/lib/extract/analyse";

const base = { id: "a.jpeg", filename: "camera.jpg", bytes: 2007 };

describe("analysing a staged photograph", () => {
  test("reads place, time and camera out of a real file", () => {
    const row = analyseStaged(base, fs.readFileSync("test/fixtures/ingest/camera.jpg"));
    expect(row.kind).toBe("image");
    expect(row.offset).toBe("+07:00");
    expect(row.lat).toBeCloseTo(15.8801, 3);
    expect(row.model).toBe("X-T5");
    expect(row.date).toBe("2026-08-23");
  });

  test("a file with no exif gets no fields at all — not a fallback to today", () => {
    const row = analyseStaged({ ...base, filename: "plain.jpg" }, Buffer.from("not a photograph"));
    expect(row.takenAt).toBeUndefined();
    expect(row.date).toBeUndefined();
    expect(row.lat).toBeUndefined();
  });

  test("a video is staged but contributes no location — B1755", () => {
    const row = analyseStaged({ ...base, id: "a.mov", filename: "IMG_1.mov" }, Buffer.from("\0\0\0\x14ftypqt  "));
    expect(row.kind).toBe("video");
    expect(row.lat).toBeUndefined();
  });
});
```

`test/fixtures/ingest/camera.jpg` and `phone.heic` both already exist and both carry full EXIF. Use them rather than authoring a fixture.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/extract-analyse.test.ts`
Expected: FAIL — `Cannot find module '@/lib/extract/analyse'`.

- [ ] **Step 3: Write the module**

```ts
import path from "node:path";
import { isoDate, isoTime, readExif } from "@/lib/ingest/exif";
import { VIDEO_EXTENSIONS } from "@/lib/ingest/video";
import type { PhotoRow } from "@/lib/staging/manifest";

/**
 * What one staged file knows about itself.
 *
 * **Nothing is filled in.** A file with no EXIF gets no date, and in
 * particular does *not* fall back to its own mtime the way `lib/ingest`'s
 * folder import does (`lib/ingest/index.ts:230`). That fallback is correct for
 * a camera card and wrong here: B1750 measured that a phone stamps every
 * uploaded file with the moment of the upload, so mtime would silently date a
 * 2019 trip to the day it was imported. Which day an undated photograph
 * belongs to is a question for the person, asked once, in the flow.
 *
 * A video is staged and counted but read for nothing. `readExif` handles JPEG,
 * HEIC and WebP; a clip's own coordinates live in QuickTime atoms nothing
 * reads yet (B1755). Marked as a video so the flow can say so, rather than
 * showing it as a photograph that mysteriously knows nothing.
 */
export function analyseStaged(
  row: Pick<PhotoRow, "id" | "filename" | "bytes">,
  bytes: Buffer,
): PhotoRow {
  const ext = path.extname(row.filename).toLowerCase();
  if (VIDEO_EXTENSIONS.has(ext)) return { ...row, kind: "video" };

  const exif = readExif(new Uint8Array(bytes));
  return {
    ...row,
    kind: "image",
    takenAt: exif.takenAt ? `${isoDate(exif.takenAt)}T${isoTime(exif.takenAt)}` : undefined,
    date: exif.takenAt ? isoDate(exif.takenAt) : undefined,
    offset: exif.offset,
    lat: exif.lat,
    lng: exif.lng,
    make: exif.make,
    model: exif.model,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/extract-analyse.test.ts`
Expected: PASS, all three. If `isoTime` returns `HH:MM` rather than `HH:MM:SS`, fix the *test's* expectation to match the real function — do not change `isoTime`, which other callers depend on.

- [ ] **Step 5: Commit**

```bash
git add lib/extract/analyse.ts test/extract-analyse.test.ts
git commit -m "feat: read a staged photograph's own metadata, and invent nothing"
```

### Task 1.2: Start and upload routes

**Files:**
- Create: `app/api/helper/[user]/extract/start/route.ts`, `app/api/helper/[user]/extract/upload/route.ts`
- Modify: `deploy/fernscout.caddy:80-101`
- Test: `test/extract-routes.test.ts`

**Interfaces:**
- Consumes: `isHelperOwner`, `notYourJournal` from `lib/helper/server.ts`; `isEnabled`; the Phase 0 store; `analyseStaged`.
- Produces: `POST …/extract/start` → `{ runId, expiresAt }`; `POST …/extract/upload` → `{ runId, accepted: PhotoRow[], rejected: { filename: string; reason: string }[] }`; `export const MAX_FILES_PER_RUN = 500`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/capabilities", () => ({ isEnabled: () => false }));

describe("the extract routes with the capability off", () => {
  test("start answers 404, not 500 and not 403", async () => {
    const { POST } = await import("@/app/api/helper/[user]/extract/start/route");
    const res = await POST(new Request("http://x/api/helper/alex/extract/start", { method: "POST" }), {
      params: Promise.resolve({ user: "alex" }),
    });
    expect(res.status).toBe(404);
  });
});
```

404 rather than 403 on purpose: an instance that has not switched the capability on should not advertise that it could.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/extract-routes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the start route**

```ts
import "server-only";
import { NextResponse } from "next/server";
import { isEnabled } from "@/lib/capabilities";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { writeManifest } from "@/lib/staging/manifest";
import { newRunId } from "@/lib/staging/paths";
import { RUN_TTL_MS, sweepStaging } from "@/lib/staging/sweep";

export const dynamic = "force-dynamic";

/**
 * Open an import run — B1751.
 *
 * Cookie only, bearer refused: `isHelperOwner` is the gate every other route
 * under `app/api/helper/` uses, and this one stages hundreds of megabytes on
 * somebody's behalf.
 *
 * The sweep runs here rather than on a schedule. A run nobody returns to is
 * cleared by the next person who starts one, and on a one-owner instance that
 * is the same person — which is the whole of what this needs.
 */
export async function POST(request: Request, ctx: { params: Promise<{ user: string }> }) {
  const { user } = await ctx.params;
  if (!isEnabled("extract", user)) {
    return NextResponse.json({ error: "extract_disabled" }, { status: 404 });
  }
  if (!(await isHelperOwner(user))) return notYourJournal();

  const now = new Date();
  sweepStaging(now);

  const body = (await request.json().catch(() => ({}))) as { tripId?: string; mode?: string };
  const runId = newRunId(now);
  const expiresAt = new Date(now.getTime() + RUN_TTL_MS).toISOString();
  writeManifest(user, {
    version: 1,
    runId,
    owner: user,
    createdAt: now.toISOString(),
    expiresAt,
    tripId: typeof body.tripId === "string" && body.tripId !== "" ? body.tripId : null,
    mode: body.mode === "voice" ? "voice" : "type",
    state: "uploading",
    photos: [],
    days: [],
  });
  return NextResponse.json({ runId, expiresAt });
}
```

- [ ] **Step 4: Write the upload route**

```ts
import "server-only";
import path from "node:path";
import { NextResponse } from "next/server";
import { isEnabled } from "@/lib/capabilities";
import { analyseStaged } from "@/lib/extract/analyse";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { VIDEO_EXTENSIONS } from "@/lib/ingest/video";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { readManifest, writeManifest, type PhotoRow } from "@/lib/staging/manifest";
import { putStagedFile } from "@/lib/staging/store";
import { IMAGE_MAX_BYTES, VIDEO_MAX_BYTES } from "@/lib/validate/media";

export const dynamic = "force-dynamic";

/** One request is one batch, not one run. The page sends ten; sixty is the
 *  ceiling so a retry of a big batch still fits in one request. */
const MAX_FILES_PER_REQUEST = 60;
/** The whole run. Past this the honest answer is "do it in two trips", which
 *  beats a run nobody can finish in one sitting. */
export const MAX_FILES_PER_RUN = 500;

export async function POST(request: Request, ctx: { params: Promise<{ user: string }> }) {
  const { user } = await ctx.params;
  if (!isEnabled("extract", user)) {
    return NextResponse.json({ error: "extract_disabled" }, { status: 404 });
  }
  if (!(await isHelperOwner(user))) return notYourJournal();

  const limit = rateLimitFor("extract-upload", clientIp(request), { max: 120, windowMs: 60_000 });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    // Reported rather than swallowed: "the request died at file 30" is a thing
    // the page has to be able to tell somebody, and a proxy cutting an
    // oversized body looks identical from the browser to a dropped signal.
    return NextResponse.json(
      { error: "body_unreadable", detail: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const runId = String(form.get("run") ?? "");
  const manifest = readManifest(user, runId);
  if (!manifest) return NextResponse.json({ error: "no_such_run" }, { status: 404 });

  const files = form.getAll("file").filter((v): v is File => v instanceof File);
  if (files.length > MAX_FILES_PER_REQUEST) {
    return NextResponse.json(
      { error: "too_many_files", max: MAX_FILES_PER_REQUEST, got: files.length },
      { status: 413 },
    );
  }

  const accepted: PhotoRow[] = [];
  const rejected: { filename: string; reason: string }[] = [];
  for (const file of files) {
    if (manifest.photos.length + accepted.length >= MAX_FILES_PER_RUN) {
      rejected.push({ filename: file.name, reason: "run_full" });
      continue;
    }
    const isVideo = VIDEO_EXTENSIONS.has(path.extname(file.name).toLowerCase());
    if (file.size > (isVideo ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES)) {
      rejected.push({ filename: file.name, reason: "too_large" });
      continue;
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const stored = putStagedFile(user, runId, file.name, bytes);
    // Content-addressed, so a retried batch is idempotent: the same photograph
    // twice is one row, and the page's retry button cannot double a day.
    if (manifest.photos.some((p) => p.id === stored.id)) continue;
    accepted.push(analyseStaged(stored, bytes));
  }

  manifest.photos.push(...accepted);
  writeManifest(user, manifest);
  return NextResponse.json({ runId, accepted, rejected });
}
```

- [ ] **Step 5: Put the upload path on the big-body proxy tier**

In `deploy/fernscout.caddy`, add to the `@bigbody` matcher **and** to `@smallbody`'s `not path` list:

```
		path /api/helper/*/extract/upload
```

This is not cosmetic. B1750 lost an hour to exactly this: a route that falls into `@smallbody` is capped at 10 MB, Caddy closes the connection partway through a batch, and both Safari and Brave report `Load failed` with no HTTP status at all.

- [ ] **Step 6: Regenerate the Caddy fixtures and read the diff**

Run: `UPDATE_CADDY_FIXTURES=1 npx vitest run test/check-caddy.test.ts`
Expected: PASS, with the path appearing in two places in `test/fixtures/caddy/expected.json` and `imported.json`.

Note for whoever deploys: `npm run check:caddy` reported a config in step while the running proxy was two directives behind (B1753). Until that is fixed, confirm by hand after deploying —
`ssh <host> 'curl -s localhost:2019/config/ | grep -c extract/upload'` must be non-zero, and `systemctl reload caddy` is what fixes it.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run test/extract-routes.test.ts test/check-caddy.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/api/helper/\[user\]/extract deploy/fernscout.caddy test/fixtures/caddy test/extract-routes.test.ts
git commit -m "feat: open an import run and take batches of photographs into staging"
```

### Task 1.3: The upload screen

**Files:**
- Create: `app/[user]/extract/page.tsx`, `components/extract/ExtractFlow.tsx`, `components/extract/UploadStep.tsx`
- Modify: `site/locales/en.json`, `site/locales/de.json`, `site/locales/hu.json`

**Interfaces:**
- Consumes: the two routes from Task 1.2.
- Produces: `<ExtractFlow username={string} />`, and `<UploadStep username={string} runId={string} onDone={(uploaded: number) => void} />`.

- [ ] **Step 1: Write the page shell**

```tsx
import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/capabilities";
import { isHelperOwner } from "@/lib/helper/server";
import ExtractFlow from "@/components/extract/ExtractFlow";

export const dynamic = "force-dynamic";

export default async function ExtractPage({ params }: PageProps<"/[user]/extract">) {
  const { user } = await params;
  // Absent, not broken: an instance without the capability has no such page at
  // all, rather than a page explaining a button it will not show.
  if (!isEnabled("extract", user)) notFound();
  if (!(await isHelperOwner(user))) notFound();
  return <ExtractFlow username={user} />;
}
```

`PageProps<"/[user]/extract">` resolves against `.next/types`, which the build writes. A worktree that has never been built fails `tsc` here and on every other route file — build first (B100).

- [ ] **Step 2: Write `UploadStep.tsx`**

```tsx
"use client";
import { useRef, useState } from "react";

type Tile = { file: File; state: "queued" | "sending" | "done" | "failed" };
const BATCH = 10;

export default function UploadStep({
  username, runId, onDone,
}: { username: string; runId: string; onDone: (uploaded: number) => void }) {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [busy, setBusy] = useState(false);
  const lock = useRef<WakeLockSentinel | null>(null);

  // A locked screen backgrounds the tab and iOS suspends a backgrounded tab's
  // network, so a long upload needs the screen kept awake. The system drops the
  // lock on every hide and does not hand it back — re-take it on the way in, or
  // it protects only until the first interruption. Measured in B1750.
  async function keepAwake(on: boolean) {
    if (!("wakeLock" in navigator)) return;
    try {
      if (on && !lock.current) lock.current = await navigator.wakeLock.request("screen");
      else if (!on && lock.current) { await lock.current.release(); lock.current = null; }
    } catch {
      // Refused — low battery, no gesture, unsupported here. The upload still
      // works; the person just has to keep the phone awake themselves.
    }
  }

  async function send(indices: number[]) {
    setBusy(true);
    await keepAwake(true);
    let uploaded = 0;
    try {
      for (let i = 0; i < indices.length; i += BATCH) {
        const slice = indices.slice(i, i + BATCH);
        setTiles((t) => t.map((x, n) => (slice.includes(n) ? { ...x, state: "sending" } : x)));
        const body = new FormData();
        body.append("run", runId);
        for (const n of slice) body.append("file", tiles[n].file, tiles[n].file.name);
        try {
          const res = await fetch(`/api/helper/${username}/extract/upload`, { method: "POST", body });
          if (!res.ok) throw new Error(String(res.status));
          uploaded += slice.length;
          setTiles((t) => t.map((x, n) => (slice.includes(n) ? { ...x, state: "done" } : x)));
        } catch {
          // One batch failing leaves every other batch's success intact and the
          // failed tiles individually retryable. A single bar for 120 files
          // would hide exactly this.
          setTiles((t) => t.map((x, n) => (slice.includes(n) ? { ...x, state: "failed" } : x)));
        }
      }
    } finally {
      await keepAwake(false);
      setBusy(false);
      onDone(uploaded);
    }
  }

  const failed = tiles.map((t, n) => (t.state === "failed" ? n : -1)).filter((n) => n >= 0);
  const queued = tiles.map((_, n) => n);

  return (
    <div>
      <input
        type="file" multiple accept="image/*,video/*" disabled={busy}
        onChange={(e) => setTiles([...(e.target.files ?? [])].map((file) => ({ file, state: "queued" })))}
      />
      <ul>
        {tiles.map((t, n) => (
          <li key={`${t.file.name}-${n}`} data-state={t.state}>{t.file.name}</li>
        ))}
      </ul>
      {tiles.length > 0 && !busy && failed.length === 0 && (
        <button type="button" onClick={() => send(queued)}>Upload {tiles.length}</button>
      )}
      {failed.length > 0 && !busy && (
        <button type="button" onClick={() => send(failed)}>Retry those {failed.length}</button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add the strings in three languages**

Every visible string goes through `site/locales/`, English first:

```json
"extract.upload.choose": "Choose from your library",
"extract.upload.send": "Upload {count}",
"extract.upload.retry": "Retry those {count}",
"extract.upload.failed": "The connection dropped partway. Everything else is safely up — these just need another go.",
"extract.upload.awake": "Keep the screen awake",
"extract.upload.awakeWhy": "A locked screen pauses the upload.",
"extract.upload.icloud": "Photos kept in iCloud download first. The first few minutes look slow — that's the download, not the upload.",
"extract.upload.perDay": "About 15 a day is plenty. The ones you'd actually show somebody."
```

If you cannot write German or Hungarian, say so and leave the task short of done. Do not invent a translation.

- [ ] **Step 4: Run the key generator**

Run: `npm run i18n:keys`
Expected: no missing keys reported.

- [ ] **Step 5: Verify in a real browser at both widths, and leave the capture on disk**

```bash
node .claude/skills/test-in-a-browser/check-page.mjs \
  "http://localhost:3000/<user>/extract" /tmp/extract-shots --widths 1280,390 --wait 2500
```

Read the JSON as well as looking at the picture: status 200, zero console errors, zero failed requests. A screenshot on its own is a thing to have an opinion about, not evidence (B1097).

- [ ] **Step 6: Commit**

```bash
git add app/\[user\]/extract components/extract site/locales
git commit -m "feat: the upload step, with per-file state and a screen wake lock"
```

---

# Phase 2 — days and questions

Ships: the photographs group into days, the gaps are visible, the questions get asked. Still nothing written to the journal.

### Task 2.1: Grouping

**Files:**
- Create: `lib/extract/group.ts`
- Test: `test/extract-group.test.ts`

**Interfaces:**
- Consumes: `clusterMedia` from `lib/ingest/cluster.ts`; `PhotoRow`.
- Produces: `export type DayGroup = { date: string; photoIds: string[]; lat?: number; lng?: number; undated: boolean }` and `export function groupIntoDays(photos: PhotoRow[]): DayGroup[]`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { groupIntoDays } from "@/lib/extract/group";
import type { PhotoRow } from "@/lib/staging/manifest";

const p = (id: string, takenAt?: string, lat?: number, lng?: number): PhotoRow => ({
  id, filename: id, bytes: 1, kind: "image", takenAt, date: takenAt?.slice(0, 10), lat, lng,
});

describe("grouping staged photographs into days", () => {
  test("one day's photographs make one group", () => {
    const groups = groupIntoDays([
      p("a", "2019-07-02T10:07:00", 15.88, 108.33),
      p("b", "2019-07-02T10:09:00", 15.88, 108.33),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].date).toBe("2019-07-02");
    expect(groups[0].photoIds).toEqual(["a", "b"]);
  });

  test("photographs with no date land in one undated group, not on today", () => {
    const groups = groupIntoDays([p("a"), p("b")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].undated).toBe(true);
    expect(groups[0].date).toBe("");
  });

  test("a group with no coordinate anywhere has no coordinate", () => {
    const groups = groupIntoDays([p("a", "2019-07-05T12:00:00")]);
    expect(groups[0].lat).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/extract-group.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

**Read `lib/ingest/cluster.ts` first and match `clusterMedia`'s input type exactly.** Do not guess at its shape or re-implement the clustering — it already handles the time-gap and distance rules and is covered by its own tests.

The module's own job is three things: map `PhotoRow[]` into whatever `clusterMedia` takes, call it, and map the clusters back to `DayGroup[]`. Undated rows never reach `clusterMedia` at all; they are collected into a single group with `undated: true` and an empty date — because the alternative, dating them from anything whatsoever, is exactly the invention this feature forbids. Put that reasoning in the file's doc comment.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/extract-group.test.ts`
Expected: PASS, all three.

- [ ] **Step 5: Commit**

```bash
git add lib/extract/group.ts test/extract-group.test.ts
git commit -m "feat: group staged photographs into days, leaving undated ones undated"
```

### Task 2.2: The questions

**Files:**
- Create: `lib/extract/questions.ts`
- Test: `test/extract-questions.test.ts`

**Interfaces:**
- Consumes: `DayGroup` from `lib/extract/group.ts`; `PhotoRow`, `DayRow`.
- Produces:

```ts
export type Question = {
  /** Stable, so an answered question is never asked twice. */
  id: string;
  kind: "opening" | "gap" | "follow-up";
  /** The literal sentence, already assembled from what the photographs said. */
  text: string;
  /** For a gap question: what answering it fills in. */
  fills?: "location" | "people" | "date";
};
export const MAX_QUESTIONS_PER_DAY = 3;
export function questionsForDay(
  group: DayGroup, photos: PhotoRow[], day: DayRow, placeName?: string,
): Question[];
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { MAX_QUESTIONS_PER_DAY, questionsForDay } from "@/lib/extract/questions";

const day = { date: "2019-07-02", answered: [] };
const group = { date: "2019-07-02", photoIds: ["a", "b"], lat: 15.88, lng: 108.33, undated: false };
const photos = [
  { id: "a", filename: "a", bytes: 1, kind: "image" as const, takenAt: "2019-07-02T10:07:00" },
  { id: "b", filename: "b", bytes: 1, kind: "image" as const, takenAt: "2019-07-02T10:41:00" },
];

describe("the questions a day still needs", () => {
  test("the opener names the day, the place, the time and the count", () => {
    const [first] = questionsForDay(group, photos, day, "Hoi An");
    expect(first.kind).toBe("opening");
    expect(first.text).toContain("Hoi An");
    expect(first.text).toContain("Tuesday");
    expect(first.text).toContain("2 photographs");
  });

  test("a day with no coordinate asks where, and says why it does not know", () => {
    const blind = { ...group, lat: undefined, lng: undefined };
    const gap = questionsForDay(blind, photos, day).find((q) => q.fills === "location");
    expect(gap).toBeDefined();
    expect(gap!.text).toContain("don't know where");
  });

  test("an answered question is never asked again", () => {
    const first = questionsForDay(group, photos, day, "Hoi An")[0];
    const again = questionsForDay(group, photos, { ...day, answered: [first.id] }, "Hoi An");
    expect(again.map((q) => q.id)).not.toContain(first.id);
  });

  test("never more than three in one day", () => {
    expect(questionsForDay(group, photos, day, "Hoi An").length).toBeLessThanOrEqual(MAX_QUESTIONS_PER_DAY);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/extract-questions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
import type { DayGroup } from "./group";
import type { DayRow, PhotoRow } from "@/lib/staging/manifest";

/**
 * What to ask about a day, in the words to ask it in.
 *
 * **The wording is the feature.** An open prompt ("tell us about this day")
 * reliably gets a sentence; a question assembled out of what the photographs
 * already said reliably gets a paragraph. Every sentence here is built from
 * real facts about this day and nothing else — the weekday, the part of the
 * day, the count, the place name if there is one. No fact, no clause.
 *
 * Three a day is a hard ceiling. Nine days at three is twenty-seven answers,
 * which is already a lot to ask of somebody's evening.
 */
export type Question = {
  id: string;
  kind: "opening" | "gap" | "follow-up";
  text: string;
  fills?: "location" | "people" | "date";
};

export const MAX_QUESTIONS_PER_DAY = 3;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Morning, afternoon or evening from the first photograph's own clock. Not a
 *  timezone calculation: EXIF wall-clock is the reading on the clock in the
 *  room, which is exactly what this sentence wants. */
function partOfDay(takenAt: string | undefined): string {
  const hour = takenAt ? Number(takenAt.slice(11, 13)) : NaN;
  if (Number.isNaN(hour)) return "";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export function questionsForDay(
  group: DayGroup,
  photos: PhotoRow[],
  day: DayRow,
  placeName?: string,
): Question[] {
  const mine = photos.filter((p) => group.photoIds.includes(p.id));
  const count = `${mine.length} photograph${mine.length === 1 ? "" : "s"}`;
  const weekday = group.date ? WEEKDAYS[new Date(`${group.date}T12:00:00Z`).getUTCDay()] : "";
  const when = [weekday, partOfDay(mine[0]?.takenAt)].filter(Boolean).join(" ");
  const where = placeName ? ` in ${placeName}` : "";
  const out: Question[] = [];

  out.push({
    id: `open:${group.date}`,
    kind: "opening",
    text: `It's ${when}${where} and you took ${count}. What were you doing?`,
  });

  if (group.lat === undefined) {
    out.push({
      id: `where:${group.date}`,
      kind: "gap",
      fills: "location",
      // Says *why* rather than showing an error badge. These files were saved
      // from somewhere else and never carried a position — a fact about the
      // photographs, not a failure anybody can be blamed for.
      text:
        `These ${count} don't know where they were — they were saved from somewhere else ` +
        `rather than taken on your phone. Where were you?`,
    });
  }

  out.push({
    id: `after:${group.date}`,
    kind: "follow-up",
    // Specific and sensory. "Anything else?" gets nothing; this either ends the
    // day or opens the next one.
    text: `What happened right after this?`,
  });

  return out.filter((q) => !day.answered.includes(q.id)).slice(0, MAX_QUESTIONS_PER_DAY);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/extract-questions.test.ts`
Expected: PASS, all four.

- [ ] **Step 5: Commit**

```bash
git add lib/extract/questions.ts test/extract-questions.test.ts
git commit -m "feat: day questions built out of what the photographs already said"
```

### Task 2.3: The run and day routes, and the board

**Files:**
- Create: `app/api/helper/[user]/extract/run/route.ts`, `app/api/helper/[user]/extract/day/route.ts`
- Create: `components/extract/DayBoard.tsx`, `components/extract/PhotoChips.tsx`, `components/extract/AskCard.tsx`
- Modify: `components/extract/ExtractFlow.tsx`, `site/locales/*`
- Test: `test/extract-routes.test.ts` (extend)

**Interfaces:**
- Consumes: `groupIntoDays`, `questionsForDay`, `parsePhotoVisibility` from `lib/photos.ts`, `reverseGeocode`/`geodataAvailable` from `lib/ingest/geo.ts`.
- Produces:
  - `GET …/extract/run?run=<id>` → `{ manifest: RunManifest; groups: DayGroup[]; questions: Record<string, Question[]> }`
  - `PATCH …/extract/run` with `{ run, photoId, caption?, visibility?, date?, dropped? }` → `{ photo: PhotoRow }`
  - `POST …/extract/day` with `{ run, date, questionId, answer, location? }` → `{ day: DayRow }`

- [ ] **Step 1: Write the failing test**

```ts
test("patching a photograph refuses a visibility word that is not one of the two", async () => {
  const { PATCH } = await import("@/app/api/helper/[user]/extract/run/route");
  const res = await PATCH(
    new Request("http://x", {
      method: "PATCH",
      body: JSON.stringify({ run: "run-1", photoId: "a", visibility: "public" }),
    }),
    { params: Promise.resolve({ user: "alex" }) },
  );
  expect(res.status).toBe(400);
});
```

`"public"` is deliberately the rejected word. A photograph narrows *within* the trip's own gate and `PHOTO_VISIBILITIES` is `["guest", "private"]` only (`lib/photos.ts:43`). Use `parsePhotoVisibility` rather than writing a second copy of that list.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/extract-routes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write both routes**

Same header as Task 1.2's routes — `dynamic = "force-dynamic"`, `isEnabled` 404, `isHelperOwner`.

`GET` reads the manifest, calls `groupIntoDays`, reverse-geocodes each group **once** (`geodataAvailable()` first; a group with no coordinate gets no name and the flow asks instead), and calls `questionsForDay` per group.

`PATCH` finds the row by id and applies only the fields present in the body. `visibility` goes through `parsePhotoVisibility`, which returns null for anything outside the two words — answer 400, not a silent drop.

`POST …/day` appends the answer to the day's `words` in the manifest and pushes the question id into `answered`. Deliberately not `appendWords` from `lib/dayReadiness.ts`: nothing is in `inbox/days/` yet and will not be until Task 3.1, so writing there now would create a half-day nothing owns.

- [ ] **Step 4: Write the three components**

- `DayBoard` is a **workspace, not a step**: any day in any order, a completeness bar each, and a "done for now" control that simply leaves. This is the one structural thing the research changed and it must not quietly become a wizard again.
- `PhotoChips` renders one chip per field in the three states the design shows — known, optional, missing — pressable, each opening its own small editor.
- `AskCard` shows one `Question` with either a microphone posting to the existing `…/transcribe` route, or a text field. **The transcript is editable.** Speech recognition gets names and places wrong, that is the normal case rather than the exception, and a read-only transcript is a published mistake.

- [ ] **Step 5: Add every new string in three languages, then run the key generator**

Run: `npm run i18n:keys`

- [ ] **Step 6: Verify in a browser at both widths**

```bash
node .claude/skills/test-in-a-browser/check-page.mjs \
  "http://localhost:3000/<user>/extract" /tmp/extract-shots-2 --widths 1280,390 --wait 2500
```

Build the run from **photographs that already existed**, not a fixture authored for this change. B1090 is the recording of what happens otherwise: a feature checked only on the two demo days the same change had edited, inert everywhere it actually mattered, found by the owner in one click.

- [ ] **Step 7: Commit**

```bash
git add app/api/helper/\[user\]/extract components/extract site/locales test/extract-routes.test.ts
git commit -m "feat: the day board, the chips and the question card"
```

---

# Phase 3 — commit to a draft

Ships: a confirmed day becomes a real draft entry. This is the phase that makes the feature worth having.

### Task 3.1: Commit one day

**Files:**
- Create: `lib/extract/commit.ts`
- Create: `app/api/helper/[user]/extract/commit/route.ts`
- Test: `test/extract-commit.test.ts`

**Interfaces:**
- Consumes: `storeInboxFile`, `moveInboxFileToDay`, `updateInboxMeta` from `lib/inbox.ts`; `writeDayReadiness`, `appendWords` from `lib/dayReadiness.ts`; `withStorageQuota` from `lib/storageQuota.ts`; `readStagedFile`.
- Produces: `export async function commitDay(username: string, runId: string, date: string): Promise<{ moved: number; entry: string | null }>`

- [ ] **Step 1: Write the failing test**

```ts
describe("committing a day", () => {
  test("moves the kept photographs into the date folder and leaves the dropped ones staged", async () => {
    // build a run with two photographs on 2019-07-02, one of them dropped: true
    const { commitDay } = await import("@/lib/extract/commit");
    const result = await commitDay("alex", "run-1", "2019-07-02");
    expect(result.moved).toBe(1);
    const { listDayInbox } = await import("@/lib/inbox");
    expect(listDayInbox("alex", "2019-07-02").media).toHaveLength(1);
  });

  test("the day's prose lands in day.json, and no location is invented", async () => {
    const { readDayReadiness, readWords } = await import("@/lib/dayReadiness");
    expect(readWords("alex", "2019-07-02")).toContain("old town for breakfast");
    // Nobody answered the where question, so nothing is written — in
    // particular not a neighbouring day's coordinate.
    expect(readDayReadiness("alex", "2019-07-02").location).toBeUndefined();
  });

  test("refuses when the journal is over its quota, and moves nothing", async () => {
    // force storageRefusal; assert listDayInbox is still empty afterwards
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/extract-commit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

This is where staging ends and the journal begins, which makes it the first point at which the quota applies. Order matters, and the doc comment is part of the deliverable:

```ts
/**
 * Move one confirmed day out of staging and into the journal.
 *
 * **The quota is checked here and nowhere earlier.** Staging deliberately
 * costs a journal nothing; the moment bytes cross into `content/<user>` they
 * are the journal's. So this is the one call that can refuse — and it refuses
 * *before* moving anything, because a half-committed day is worse than a
 * refused one.
 *
 * Everything after the move is somebody else's code, on purpose.
 * `storeInboxFile` + `moveInboxFileToDay` put the photographs where
 * `inbox/days/<date>/` expects them, `writeDayReadiness` and `appendWords`
 * write the `day.json` that path already reads, and `assemble-day` — not this
 * file — creates the entry. Re-implementing any of it here would be a second
 * answer to a question that already has one.
 */
```

Dropped rows are skipped and left in staging for the sweep. Each moved row carries its caption and visibility across through `updateInboxMeta`. A row whose `date` the person changed goes to the date they chose, never the one EXIF guessed.

- [ ] **Step 4: Write the route**

`POST …/extract/commit` with `{ run, date }`. Same gates as every other route here. On success, mark the `DayRow` `committed: true` and return the created entry's slug so the preview can link to it.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/extract-commit.test.ts`
Expected: PASS, all three.

- [ ] **Step 6: Prove the draft is a draft**

Run the whole thing against a local journal and assert on the file that lands: the entry's frontmatter says `status: draft`, and nothing anywhere in this branch sets it otherwise. This is the constraint the entire plan is built to keep, and the only acceptable evidence is the file on disk.

- [ ] **Step 7: Commit**

```bash
git add lib/extract/commit.ts app/api/helper/\[user\]/extract/commit test/extract-commit.test.ts
git commit -m "feat: commit a confirmed day into the existing day-assembly path"
```

### Task 3.2: The security pass

**Files:** none — this is a review, and its findings are tickets.

- [ ] **Step 1: Run the security review over the branch**

Every route here is an owner route that stages other people's photographs and then moves bytes into a journal. Run the `claude-security` skill over the branch before merging. The five checks in `npm run verify` prove the code runs; they do not prove it keeps its secrets, and the bug this repository keeps finding is the second kind.

- [ ] **Step 2: Triage what it finds**

A defect this branch introduced is fixed on this branch, without exception. A finding that would exist if this branch had never been cut is a new ticket in `backlog/` by id — get the id from `npm run tasks -- new`, never by reading the folder and adding one. A finding you disagree with gets a sentence in the task file saying why.

- [ ] **Step 3: Commit any fixes**

```bash
git commit -m "fix: <what the review found>"
```

---

# Phase 4 — enrichment, preview, resume, and the guide

Ships: the paid half, the preview, the resume screen and `/docs/extract`. These four tasks are independent of each other.

### Task 4.1: One free sample, then the credits

**Files:**
- Create: `app/api/helper/[user]/extract/sample/route.ts`
- Modify: `components/extract/ExtractFlow.tsx`, `site/locales/*`
- Test: `test/extract-routes.test.ts` (extend)

**Interfaces:**
- Consumes: `describePhotos` from `lib/helper/model.ts`; `resizedCopy` from `lib/media.ts`; `creditsForPhotos` from `lib/helper/credits.ts`; `balanceOf`, `spend` from `lib/credits.ts`.
- Produces: `POST …/extract/sample` with `{ run, photoId }` → `{ caption: string }`, charged nothing, once per run.

- [ ] **Step 1: Write the failing test**

```ts
test("the sample is free, and only one per run", async () => {
  const { POST } = await import("@/app/api/helper/[user]/extract/sample/route");
  const call = () => POST(
    new Request("http://x", { method: "POST", body: JSON.stringify({ run: "run-1", photoId: "a" }) }),
    { params: Promise.resolve({ user: "alex" }) },
  );
  expect((await call()).status).toBe(200);
  expect((await call()).status).toBe(409);
});
```

One per run is the whole of the abuse control, and it is not a rate-limit problem — it is a "this is a taste, not a free tier" problem, and the run id is the natural key. `sampleTakenFor` on the manifest records it; nothing goes in the ledger, because nothing was spent and a ledger row for a free thing is a lie about the balance.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/extract-routes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the route**

Reuse `describePhotos` exactly as `app/api/helper/[user]/day/describe-photos/route.ts` does — including sending a `resizedCopy` and never an original, and returning a suggestion rather than writing anything.

- [ ] **Step 4: Write the credits screen**

Every line priced from the real function — `creditsForPhotos(n)` for descriptions — never a number typed into a component, or the screen and the charge drift apart within a month. Show the total and the balance after it. With the `credits` capability off the screen is absent, not a broken button.

The free path — "Build it from what I wrote" — produces a complete trip. It is not a dark pattern and must not become one: the person's own words are the point of the feature, and the credits buy polish on top of them.

**Above the button, and not in small print, say what a spend is tied to.** Enrichment is generated into the run, and a run that expires takes it with it — no refund (owner's decision, see the table near the top). So:

```json
"extract.credits.tiedToRun": "This is written into your import. If you leave it to expire, the writing goes with it and the credits aren't returned — so finish the trip, or leave this until you're ready to."
```

That sentence is the price of the no-refund rule. Without it the rule is a trap; with it, it is a term somebody agreed to. A reviewer should check it is above the button rather than below it, and that it is not styled as a footnote.

- [ ] **Step 5: Write the failing test for the warning line**

```ts
test("the credits screen says what a spend is tied to, above the button", () => {
  // render the screen with a non-zero total; assert the tiedToRun string is
  // present and appears before the spend button in document order.
});
```

A string that has to be above a button is a thing a test can hold, and this one is load-bearing: it is the whole difference between a term and a trap.

- [ ] **Step 6: Run the tests, then verify in a browser with credits off and on**

- [ ] **Step 7: Commit**

```bash
git add app/api/helper/\[user\]/extract/sample components/extract site/locales test/extract-routes.test.ts
git commit -m "feat: one free sample description, and say what a spend is tied to"
```

### Task 4.2: Preview, people, and publish

**Files:**
- Modify: `components/extract/ExtractFlow.tsx`, `site/locales/*`

- [ ] **Step 1: Link the preview at the real trip pages**

The draft is the trip, on the site's own pages. Do not build a second renderer — a preview that renders differently from the thing is a preview of something nobody will ever see.

- [ ] **Step 2: Write the trip's people through the route that already exists**

`app/api/helper/[user]/trip/people/route.ts` takes the travellers list. Call it; do not add a second writer for the same field.

Drawing figures from a photograph is **deliberately out of scope for this plan.** It is a model-drawing feature with its own cost story and its own consent question, and it belongs in its own ticket rather than bolted onto an import.

- [ ] **Step 3: Publishing is the existing owner control**

`app/api/helper/[user]/day/publish/route.ts` exists and already asks for consent. This flow **links** to it and never calls it. Nothing under `components/extract/` may publish, and a reviewer should check that by grep.

- [ ] **Step 4: Verify in a browser at both widths and commit**

```bash
git add components/extract site/locales
git commit -m "feat: preview the draft on the trip's own pages, and stop there"
```

### Task 4.3: The resume screen

**Files:**
- Create: `app/api/helper/[user]/extract/runs/route.ts`
- Modify: `components/extract/ExtractFlow.tsx`, `site/locales/*`
- Test: `test/extract-routes.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
test("lists this owner's live runs, newest first, and nobody else's", async () => {
  // two runs for alex, one for sam; GET as alex returns exactly two, newest first
});
```

- [ ] **Step 2: Run it and watch it fail, then write the route**

`GET …/extract/runs` → `{ runs: RunManifest[] }` straight from `listRuns(user)`, which already sorts newest-first. Same gates.

- [ ] **Step 3: Build the screen**

It names where the person stopped, how many days are left, and — plainly — how long the held photographs last. Life-story interviewing is explicit that this kind of work goes better spread over days, so the screen's tone is "there is no hurry, but there is a clock", not a nag.

The expiry rule is decided (see the table near the top) and this screen is where a person meets it. Three states, three sentences:

- **Not yet warned** — "There's no hurry, but there is a clock: unused photographs are cleared about two days after you upload them."
- **Warned, not extended** — name the real deadline from `expiresAt`, and say plainly that being here has just extended it. Arriving *is* the extension (`extendOnTouch` has already run in the route by the time this renders), so the copy is past tense: *"You had until {deadline}. Because you came back, you've got until {newDeadline} — that's the one extension."* Telling somebody they *can* extend, on a screen whose loading already did it, is a lie about their own state.
- **Extended** — the new deadline, and that there is no further one.

In every state, the line that matters most is that finished days are already part of the journal and are not affected. Put it above the fold, not in a footnote.

- [ ] **Step 4: Verify in a browser and commit**

```bash
git add app/api/helper/\[user\]/extract/runs components/extract site/locales
git commit -m "feat: resume an import somebody left half-finished"
```

### Task 4.4: The guide at /docs/extract

**Files:**
- Create: the page, through whatever mechanism `lib/docs.ts` and `components/DocsNav.tsx` already use
- Modify: `site/locales/*`

- [ ] **Step 1: Read `lib/docs.ts` and `components/DocsNav.tsx` first**

Follow what is there. A second mechanism for writing a documentation page is exactly the kind of thing this repository's own rules forbid, and it will be caught in review.

- [ ] **Step 2: Write one section per kind of data**

Google Timeline, contacts, photographs with location on iOS and on Android, bank statements for costs (B1581 is the same problem for Revolut). Each route **followed end to end by somebody before it is published**, and dated — these exports move, and an undated instruction is a wrong instruction waiting to happen.

- [ ] **Step 3: Commit**

```bash
git add app/docs site/locales
git commit -m "docs: how to get your own data out of the places it lives"
```

---

# Phase 5 — optional, and deliberately last

### Task 5.1: An object-storage driver

**Files:**
- Modify: `lib/staging/store.ts` — lift the four functions behind a driver interface
- Create: `lib/staging/s3.ts`

Start this only when somebody has measured that local disk is not enough. The interface is already the seam. The local driver stays the default and stays the tested one, because a feature that needs a paid account to develop is one this repository does not accept. Lifecycle rules on the bucket replace `sweepStaging` for that driver only — and `sweepStaging` stays, because the local driver still needs it.

---

## Self-review

**Spec coverage.** The owner's expiry decision of 2026-09-15 → Task 0.5 (warn, pin, extend, final notice) and Task 4.3 Step 3. The owner's no-refund decision of the same day → Task 4.1 Steps 4-5 (said before the spend, and tested for) and Task 0.5 Step 5 (`extract.expiry.spent`, read from the ledger, appended to both messages) (what the person is told, in each of the three states). Design Step 01 → Tasks 1.3 and 4.3 (expectation setter, resume). Step 02 → Task 1.2 (`tripId` and `mode` on the manifest) and 1.3. Step 03 → Tasks 1.2 and 1.3 (limits stated first, per-file tiles, individual retry, wake lock, the Caddy tier). Step 04 → Tasks 1.1 and 2.3 (what was found, said as numbers). Step 05 → Tasks 2.1 and 2.3 (the day board as a workspace). Step 06 → Task 2.3 (`PhotoChips` and the `PATCH`). Step 07 → Tasks 2.2 and 2.3 (`AskCard`, editable transcript, three questions a day). Step 08 → Task 4.2 for the travellers list; **the figure drawing is explicitly out of scope and said so**, rather than left as an unclaimed requirement. Step 09 → Task 4.1. Step 10 → Task 4.2.

**Placeholder scan.** Four steps describe an implementation without a full code block — 2.1 Step 3, 2.3 Steps 3–4, 3.1 Step 3 and 4.4 Step 1. That is deliberate in exactly those four and nowhere else: each is "go and read the existing module, then match its shape", and pasting a guessed signature for `clusterMedia`, `assemble-day` or the docs mechanism would be worse than sending the implementer to the source. Every step that introduces a *new* interface carries its real code.

**Type consistency.** `PhotoRow`, `DayRow`, `RunManifest` (Task 0.3), `DayGroup` (Task 2.1) and `Question` (Task 2.2) are each defined once and used unchanged afterwards. `visibility` is `"guest" | "private"` everywhere, matching `PHOTO_VISIBILITIES`. `analyseStaged` takes `Pick<PhotoRow, "id" | "filename" | "bytes">`, which is exactly what `putStagedFile` returns. `sweepStaging(now: Date)`, `newRunId(now: Date)`, `expiryActionFor(run, now)` and `extendOnTouch(run, now)` all take the instant rather than reading the clock, so each is testable and none needs `Date.now()`. `RunManifest` gains exactly three optional stamps — `warnedAt`, `extendedAt`, `finalNoticeAt` — all defined in Task 0.3's type and written only by Task 0.5.
