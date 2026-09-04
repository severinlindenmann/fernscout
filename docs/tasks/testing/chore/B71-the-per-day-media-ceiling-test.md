---
id: B71
title: The per-day media ceiling test asserts on problems[0], and failed once in a full run
type: CHORE
priority: low
complexity: low
area: tests, media
found: "2026-09-01"
started: "2026-09-04T05:58:33Z"
merged: "2026-09-04T06:30:05Z"
---

# B71 — The per-day media ceiling test asserts on problems[0], and failed once in a full run

## Why

Noticed while verifying **B52**, in a part of the tree that task does not touch.

`test/media-upload.test.ts:173`, in *"the per-day ceiling counts what is already
on disk"*, asserts:

```ts
expect(over.problems[0].expected).toContain(`at most ${MAX_ITEMS_PER_DAY} per day`);
```

`storeUploads` (`lib/api/media.ts:200–236`) builds `problems` by appending: the
batch validation first (`validateMediaBatch` — format, size, dimensions,
duration), then the missing-ffmpeg case, then the per-day ceiling, then the
journal byte quota. **Nothing promises the ceiling is first**, and it is only
first here because the fixture happens to break no other limit. Any new check
added ahead of it, or any fixture that trips a second limit, fails this
assertion with a message about the wrong rule. `problems.some(p => p.expected
=== …)` says what the test means; `[0]` says where it happens to sit today.

The reason it is written down rather than just fixed in passing: it **failed
once**, on the first full `npx vitest run` in a fresh worktree, with the caret on
that line — the ceiling was not the first problem reported. Six subsequent full
runs and five targeted runs of that file alone were green, and the failing
output was not kept, so what the other problem was is unknown. That is thin
evidence and should be treated as a lead, not a diagnosis.

Worth knowing while looking: the test uploads `MAX_ITEMS_PER_DAY` files one at a
time through `sharp` before the assertion, so it is one of the slowest tests in
the file, and the suite runs files in parallel.

## Work

- Assert on the problem the test is about, not on the array's first element —
  `problems.some(...)`, or filter by `field`. That is worth doing whether or not
  the flake is real, and it is what makes a real one legible when it recurs.
- If it recurs, keep the output: which problem came first is the whole answer.
  Look at `existing` (`lib/api/media.ts:190`, a `readdirSync` count of the day's
  media directory) and at whether all `MAX_ITEMS_PER_DAY` writes actually landed
  before the last call.
- Check the rest of the file for the same `problems[0]` shape.

**Not doing:** chasing an unreproducible failure any further than the assertion.
If it does not come back, the tidier assertion is the whole of it.

## Acceptance

- No assertion in `test/media-upload.test.ts` depends on the order in which
  `storeUploads` appends problems.
- `npx vitest run` green, and the four checks.

## What was built

All five order-dependent assertions in `test/media-upload.test.ts` are gone —
the ceiling one the task names, and the four others found by the "check the
rest of the file" line: two `.format` assertions, the not-really-an-image one,
and the `day` one. They go through one helper:

```ts
function only(problems: Problem[], what: string, match: (p: Problem) => boolean): Problem
```

It asserts **exactly one** match and puts the whole array into the failure
message, because "which problem came first" is the answer to the flake if it
ever recurs and the original output was not kept.

Two things make the ceiling test itself deterministic rather than merely
correct:

- Every one of the `MAX_ITEMS_PER_DAY` writes is now asserted to have landed,
  and the day's media directory is asserted to hold exactly that many files
  before the over-limit call. `existing` is a `readdirSync` count
  (`lib/api/media.ts:200`), so a short write would previously have produced a
  pass, not a failure — the test would simply have stopped testing the ceiling.
- The 60px square is encoded once and reused instead of forty times. Nothing
  depended on forty distinct files, and this was the slowest test in the file.

## What the flake was not

Not chased further than the assertion, per the task, but three candidates were
ruled out cheaply while reading:

- **Cross-file `CONTENT_DIR` interference.** Vitest 4's default pool is
  `forks`, so `process.env` is per-process; the shared-env hazard belongs to
  the `threads` pool, which this repo does not use.
- **A second limit firing.** With one 60×60 JPEG there is nothing else to
  break: format is `jpeg`, size is tiny, `kindOf` says image so ffmpeg is not
  consulted, and the fixture sets no `perUserBytes`.
- **`validateMediaBatch`'s own per-day problem** (`lib/validate/media.ts:135`),
  which carries the *same* `expected` string and would have satisfied the old
  `toContain`. It needs `items.length > 40` in one request, and the test sends
  one. It is a real confusion for a caller, though, and is captured as **B209**.

Ten consecutive full `npx vitest run` passes after the change; see the report.

## Evidence

- `grep -n "problems\[" test/media-upload.test.ts` → no matches.
- `npx vitest run test/media-upload.test.ts` → 27 passed, 1.36s of test time
  (was ~2.5s).
