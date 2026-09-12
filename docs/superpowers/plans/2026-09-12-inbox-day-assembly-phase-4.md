# Inbox day-assembly Phase 4: a persistent statement store — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a bank statement's parsed, agreed rows on disk after they are
first reconciled — mirroring `gps/`'s own shape — so a day written weeks
later can still ask "is there a cost for this date I have not applied yet?"
instead of the reconciliation being usable only once, at the moment of
import.

**Architecture:** This is the one genuinely new subsystem in the whole
design (the spec says so explicitly) and the codebase confirms why: today,
`readStatement` (`lib/statements/read.ts`) parses and reports in memory with
nothing kept, and `applyCosts` (`lib/statements/apply.ts`) writes agreed rows
straight onto whatever days already exist, dropping any row whose date has
no day (`orphaned`) with nothing persisted for it to be retried later. Phase
4 adds a new store, `content/<user>/statements/<imported-file-id>.json`,
written once at the same "agree the categories" moment `applyCosts` already
has, and read from thereafter by anything asking whether a date has
unapplied rows — including Phase 3's `assemble_day`, extended in this plan's
final task to answer `costs` from the store as well as from
`day.json`/`without`/`unrecorded`.

**Tech Stack:** Existing `lib/statements/read.ts`/`apply.ts` types
(`Payment`, `CostRow`, `ApplyResult`), Node `fs`, the existing
`content/<user>/` root helper (`contentRoot()`, `lib/contentRoot.ts`).

**Spec:** `docs/superpowers/specs/2026-09-12-inbox-day-assembly-design.md`
(Phase 4 section — "a persistent statement store")

## Global Constraints

- **Mirrors `gps/`'s shape, not its access rules.** `gps/` is uniquely
  sensitive (a full location history) and is reachable from nothing under
  `app/`. A statement store is not a comparable secret in the same way — a
  trip's own `costs.md` is already readable by anyone the trip lets in, and
  `lib/statements/apply.ts` already writes costs straight onto days anyone
  with trip-write access can read. So this store needs **no** import-graph
  guard equivalent to `test/gps-store.test.ts`'s — the "ask once, use many
  times" shape is what is being mirrored, not the privacy posture.
- **Not retroactive.** Rows already applied under today's one-shot flow (any
  statement imported before this phase ships) are not migrated in. The store
  starts empty for every existing journal.
- **`applyCosts`'s existing behavior is unchanged for a date that has a day.**
  This phase only changes what happens to a row whose date has *no* day yet
  — instead of being silently dropped into `orphaned` and forgotten, it is
  kept, so a day written later can still claim it.
- **One git command per shell call, and clone `node_modules` with `cp -Rc`**
  — this repository's own worktree rules (AGENTS.md), unchanged by this plan.

---

### Task 1: The store itself — write, read, and mark-applied

**Files:**
- Create: `lib/statements/store.ts`
- Test: `test/statements-store.test.ts`

**Interfaces:**
- Consumes: `CostRow` (existing, `lib/statements/apply.ts`); `contentRoot`
  (existing, `lib/contentRoot.ts`).
- Produces: `StoredStatement` type, `writeStatementRows(username, importId, rows: CostRow[]): void`,
  `readUnappliedRows(username, dateFrom: string, dateTo: string): { importId: string; row: CostRow }[]`,
  `markApplied(username, importId: string, rowIndexes: number[]): void`.
  Task 2 and Phase 3's own extension both consume `readUnappliedRows`; the
  existing `costs/import` route (Task 2) is the only writer of
  `writeStatementRows`/caller of `markApplied`.

- [ ] **Step 1: Write the failing tests**

Create `test/statements-store.test.ts`. Reuse the `journal()` fixture
pattern from `test/helper-room-files.test.ts`.

```ts
import { describe, expect, test } from "vitest";
import { writeStatementRows, readUnappliedRows, markApplied } from "@/lib/statements/store";
import type { CostRow } from "@/lib/statements/apply";

const ROW = (date: string, label: string): CostRow => ({
  date, label, amount: 42, currency: "EUR", category: "food",
});

describe("writeStatementRows / readUnappliedRows", () => {
  test("a freshly written statement's rows are all unapplied", () => {
    journal();
    writeStatementRows("u", "revolut-2026-05", [ROW("2026-05-04", "Cafe"), ROW("2026-05-10", "Hotel")]);
    const rows = readUnappliedRows("u", "2026-05-01", "2026-05-31");
    expect(rows.map((r) => r.row.label)).toEqual(["Cafe", "Hotel"]);
  });

  test("a date range excludes rows outside it", () => {
    journal();
    writeStatementRows("u", "revolut-2026-05", [ROW("2026-05-04", "Cafe"), ROW("2026-06-01", "Later")]);
    const rows = readUnappliedRows("u", "2026-05-01", "2026-05-31");
    expect(rows.map((r) => r.row.label)).toEqual(["Cafe"]);
  });

  test("markApplied hides a row from later reads without deleting the import", () => {
    journal();
    writeStatementRows("u", "revolut-2026-05", [ROW("2026-05-04", "Cafe"), ROW("2026-05-10", "Hotel")]);
    markApplied("u", "revolut-2026-05", [0]);
    const rows = readUnappliedRows("u", "2026-05-01", "2026-05-31");
    expect(rows.map((r) => r.row.label)).toEqual(["Hotel"]);
  });

  test("a journal with no imports reads as nothing, not as an error", () => {
    journal();
    expect(readUnappliedRows("u", "2026-01-01", "2026-12-31")).toEqual([]);
  });

  test("re-writing the same importId replaces its rows outright", () => {
    // A re-import of the same statement (a person re-uploads the same file)
    // is expected to replace, not duplicate — writeStatementRows is keyed by
    // importId and idempotent on re-write, mirroring gps/'s own
    // idempotent-on-reimport shape.
    journal();
    writeStatementRows("u", "revolut-2026-05", [ROW("2026-05-04", "Cafe")]);
    writeStatementRows("u", "revolut-2026-05", [ROW("2026-05-04", "Cafe"), ROW("2026-05-05", "Bakery")]);
    const rows = readUnappliedRows("u", "2026-05-01", "2026-05-31");
    expect(rows).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/statements-store.test.ts`
Expected: FAIL — `lib/statements/store.ts` does not exist.

- [ ] **Step 3: Write the implementation**

Create `lib/statements/store.ts`:

```ts
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "../contentRoot";
import type { CostRow } from "./apply";

/**
 * Every agreed row from one statement import, kept — Phase 4, B677's
 * successor.
 *
 * Mirrors `gps/`'s own shape: a resource that outlives any one day, agreed
 * once (the same "person agrees the categories" step `applyCosts` already
 * asks for) and read many times afterwards. `applyCosts` still writes
 * straight onto a day that already exists when it is called — this store is
 * for the rows a day did **not** exist for yet, so a day written weeks later
 * can still claim them, instead of them being dropped into `orphaned` and
 * forgotten as they are today.
 *
 * One file per import (`<imported-file-id>.json`), not one file per
 * statement's whole history, for the same reason `gps/`'s month files exist:
 * a re-import replaces its own file outright rather than requiring a merge
 * against everything that came before.
 */
export type StoredRow = CostRow & { applied: boolean };
export type StoredStatement = { importId: string; rows: StoredRow[] };

function statementsDir(username: string): string {
  return path.join(contentRoot(), username, "statements");
}

function statementPath(username: string, importId: string): string {
  return path.join(statementsDir(username), `${importId}.json`);
}

/** Every import filed for this journal — used by `readUnappliedRows`, which
 *  has to look across all of them rather than one at a time. */
function allImports(username: string): StoredStatement[] {
  let names: string[];
  try {
    names = fs.readdirSync(statementsDir(username));
  } catch {
    return [];
  }
  const out: StoredStatement[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(statementsDir(username), name), "utf8")) as StoredStatement);
    } catch {
      // A half-written file from an interrupted write. Skipping one import
      // is nothing next to refusing every other one over it.
    }
  }
  return out;
}

/**
 * File one statement's agreed rows, replacing whatever this same `importId`
 * held before — a re-import of the same file is expected to happen and is
 * idempotent by design, the same shape `gps/`'s own re-import handling has.
 * Every row starts `applied: false`; `applyCosts`/`markApplied` are what
 * turn that to `true`, one day at a time.
 */
export function writeStatementRows(username: string, importId: string, rows: CostRow[]): void {
  const dir = statementsDir(username);
  fs.mkdirSync(dir, { recursive: true });
  const stored: StoredStatement = {
    importId,
    rows: rows.map((row) => ({ ...row, applied: false })),
  };
  const target = statementPath(username, importId);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, target);
}

/** Every row, across every import this journal holds, dated in
 *  `[from, to]` and not yet applied. This is what answers "is there a cost
 *  for this date nobody has claimed yet" — the read Phase 3's `assemble_day`
 *  extension needs. */
export function readUnappliedRows(
  username: string,
  from: string,
  to: string,
): { importId: string; row: CostRow }[] {
  const out: { importId: string; row: CostRow }[] = [];
  for (const statement of allImports(username)) {
    statement.rows.forEach((row) => {
      if (row.applied) return;
      if (row.date < from || row.date > to) return;
      out.push({ importId: statement.importId, row });
    });
  }
  return out;
}

/** Mark specific rows (by their index within one import) as applied — called
 *  once `applyCosts` has actually written them onto a day. Rows are never
 *  deleted, only flagged: the import stays the record of the whole
 *  statement, applied or not. */
export function markApplied(username: string, importId: string, rowIndexes: number[]): void {
  const target = statementPath(username, importId);
  let stored: StoredStatement;
  try {
    stored = JSON.parse(fs.readFileSync(target, "utf8")) as StoredStatement;
  } catch {
    return; // Nothing to mark — the import was never written, or is gone.
  }
  for (const i of rowIndexes) {
    if (stored.rows[i]) stored.rows[i].applied = true;
  }
  fs.writeFileSync(target, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/statements-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/statements/store.ts test/statements-store.test.ts
git commit -m "A persistent statement store, mirroring gps/'s ask-once shape — rows kept and flagged applied rather than dropped (SDD plan: inbox day-assembly Phase 4, Task 1)"
```

---

### Task 2: Wire the store into the existing import/apply flow

**Files:**
- Modify: `app/api/v1/[user]/trips/[trip]/costs/import/route.ts` (the
  existing route that calls `applyCosts`)
- Modify: `lib/statements/apply.ts` (`applyCosts`'s return shape, to report
  which rows were newly stored rather than applied)
- Test: extend the existing test file for this route (find it — likely
  `test/costs-import-route.test.ts` or similar; search for `applyCosts` in
  `test/`)

**Interfaces:**
- Consumes: `writeStatementRows`, `markApplied` (Task 1).

- [ ] **Step 1: Read the current route and `applyCosts` in full**

Read `app/api/v1/[user]/trips/[trip]/costs/import/route.ts` and
`lib/statements/apply.ts`'s `applyCosts` (already read in full during this
plan's research — re-read for exact current line numbers before editing).
Note the route needs an `importId` to key the store by — check whether the
request body already carries one (the original `POST .../import` read
response likely returns something identifying the statement — check
`CostsOutcome`'s fields in `lib/statements/read.ts`) or whether one must be
minted here (e.g. a hash of the sorted rows, or a client-supplied id).

- [ ] **Step 2: Write the failing test**

Add to the existing costs-import route test file:

```ts
test("a row whose date has no day yet is kept in the statement store, not dropped", async () => {
  // POST rows including one dated before the trip's first written day.
  // Assert: 200, orphaned still reports it (unchanged behavior for the
  // caller), AND readUnappliedRows (imported directly in the test) shows
  // that row present and unapplied afterwards.
});

test("a row applied onto a real day is marked applied in the store and not read back as unapplied", async () => {
  // POST rows all dated to existing days.
  // Assert: readUnappliedRows for that range is empty afterwards.
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run <the costs-import route test file>`
Expected: FAIL — nothing writes to the store yet.

- [ ] **Step 4: Wire `writeStatementRows`/`markApplied` into the route**

In the route (not inside `applyCosts` itself, to keep `applyCosts` a pure
function over `rows`/`entries` as it is today — read its own module comment
again, "no fs, no request, no journal" is `lib/tracks.ts`'s own stated
principle and `applyCosts` already partially follows it via `getAllEntries`;
keep the store-writing at the route's edge):

```ts
// After validateRows() succeeds and before calling applyCosts, or
// immediately after — either order is fine since writeStatementRows and
// applyCosts do not depend on each other's result — mint or accept an
// importId and call:
writeStatementRows(user, importId, rows);
const result = applyCosts(ref, rows);
// Then mark every row that WAS written (result.written accounts for
// per-day rows; map each written date's rows back to their original index
// in `rows` — or, simpler, have applyCosts itself return which row indexes
// it wrote, since it already iterates `rows` — see Step 5 below) as applied.
markApplied(user, importId, appliedIndexes);
```

- [ ] **Step 5: Extend `applyCosts`'s return to report which indexes it wrote**

`ApplyResult` currently returns `written`/`orphaned`/`total` with no way to
map a written day back to which of the *caller's original* `rows` array
indexes it came from (it groups by date internally). Add an
`appliedIndexes: number[]` field, populated by tracking each row's original
index alongside its date when building `byDate` in `applyCosts` — the
`byDate` map already needs to change from `Map<string, CostRow[]>` to
`Map<string, { index: number; row: CostRow }[]>` (or similar) to carry this
through. Update `applyCosts`'s existing tests (in whatever test file already
covers `lib/statements/apply.ts`) for the new field — check they still pass
with an added field on the result, since most assertions probably check
specific fields rather than the whole object shape.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run <the costs-import route test file> <lib/statements/apply.ts's existing test file>`
Expected: PASS

- [ ] **Step 7: Run the full costs regression**

Run: `npx vitest run` filtered to every file touching `costs`/`statements`
(`grep -rl "statements\|costs/import" test/ | grep -v node_modules`) to
confirm nothing else assumed `ApplyResult`'s old shape.

- [ ] **Step 8: Commit**

```bash
git add app/api/v1/\[user\]/trips/\[trip\]/costs/import/route.ts lib/statements/apply.ts test/
git commit -m "Wire the persistent statement store into costs/import: rows for a date with no day yet are kept, not dropped (SDD plan: inbox day-assembly Phase 4, Task 2)"
```

---

### Task 3: `assemble_day` reads the store too

**Files:**
- Modify: `lib/dayMissing.ts` (Phase 3's `missingForDayFolder`)
- Test: extend `test/day-missing.test.ts` (Phase 3)

**Interfaces:**
- Consumes: `readUnappliedRows` (Task 1).

**Why this task is last, and small:** it is the one place Phase 3 and Phase
4 actually meet, and the spec is explicit that Phase 3 "degrades gracefully
without it" — this task only runs once both Phase 3 and Phase 4 have shipped
independently; nothing here is required for either to work alone.

- [ ] **Step 1: Write the failing test**

Add to `test/day-missing.test.ts` (Phase 3's file):

```ts
test("a date with an unapplied statement row does not ask about costs", () => {
  journal();
  writeStatementRows("u", "revolut-2026-05", [
    { date: "2026-05-04", label: "Cafe", amount: 42, currency: "EUR", category: "food" },
  ]);
  const fields = missingForDayFolder("u", "2026-05-04", ALL_TRACKED).map((m) => m.field);
  expect(fields).not.toContain("costs");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/day-missing.test.ts`
Expected: FAIL — `missingForDayFolder` still asks about costs.

- [ ] **Step 3: Extend `missingForDayFolder`**

In `lib/dayMissing.ts`, before building `facts.costs`, check the store:

```ts
import { readUnappliedRows } from "./statements/store";

// Inside missingForDayFolder, before constructing `facts`:
const hasUnappliedCost = readUnappliedRows(username, date, date).length > 0;

const facts: DayFacts = {
  costs: hasUnappliedCost,
  // ...unchanged
};
```

This makes `costs` read as "answered" (via `missingFrom`'s existing
`!facts[key]` check) whenever the store has a row for exactly this date,
same as the existing behavior for `coordinates`/`photos` already deriving
from what is actually present rather than being asked about blind. Whether
`assemble_day`'s create step (Phase 3, Task 3) should then also apply that
row onto the new entry automatically, or merely stop asking about it and
leave the apply for a person to do explicitly afterward, is this task's own
open decision — the spec does not say, and the safer default (never write a
cost without an explicit apply) is to leave the store's rows unapplied here
and only stop *asking*, not silently apply on the day's behalf. Record this
choice in the ledger if using the SDD process, since it is exactly the kind
of ruling the process asks controllers to make and record rather than guess
at silently.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/day-missing.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/dayMissing.ts test/day-missing.test.ts
git commit -m "assemble_day stops asking about costs once the statement store already has an unapplied row for that date (SDD plan: inbox day-assembly Phase 4, Task 3)"
```

---

## Final check

- [ ] Run `npm run verify` in full.
- [ ] Confirm `content/<user>/statements/` needs no new gitignore entry if
  the whole of `content/<user>/` is already covered the way `content/<user>/inbox/`
  is — check `.gitignore` directly; if `statements/` would otherwise be
  tracked (unlike `inbox/`, which the spec treats as scratch), decide
  explicitly whether this store is content a person owns (kept, like
  `gps/`) or scratch (gitignored, like `inbox/`) and match `.gitignore`
  accordingly — the spec's own framing ("mirrors `gps/`'s own shape") argues
  for **kept**, in a person's backup and export, same as `gps/` is (per
  AGENTS.md, `lib/storageQuota.ts` already counts the whole of
  `content/<user>/`, so no separate quota work is needed either way).
