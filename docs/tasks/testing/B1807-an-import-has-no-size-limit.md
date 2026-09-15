---
id: B1807
title: Staging has no size limit, so one journal's abandoned imports can fill the disk
type: FEATURE
priority: high
complexity: low
area: extract, staging, limits
found: "2026-09-15T17:45:30Z"
started: "2026-09-15T17:46:00Z"
merged: "2026-09-15T18:57:15Z"
---

# B1807 — An import has no size limit, so one camera roll can fill the disk

## Why

An import is capped at 500 files (`MAX_FILES_PER_RUN`,
`app/api/helper/[user]/extract/upload/route.ts:20`) and at 50 MB per photograph
or 500 MB per clip (`lib/validate/media.ts`). Multiply those out and one import
can legitimately stage **far more than any instance wants to hold**: 500 clips
at the per-file ceiling is 250 GB, and staging deliberately sits outside the
journal's storage quota, so nothing else stops it.

That was a reasonable gap while the feature was a photographs-only prototype. It
is not reasonable now that videos upload, because a camera roll is full of them —
the owner's own test folder was roughly half `.mov`.

And there is a second problem, which is the one a person actually meets:
**nothing tells them how much room they have.** The upload screen lists the
formats it takes, the file count and the per-file ceiling, precisely so a person
learns the limits before spending four minutes selecting. The one limit that
will actually stop them is absent from that list.

## Work

**A ceiling of 10 GB per journal**, decided by the owner (2026-09-15).

Per *journal*, not per run — corrected after this ticket was first written, which
had it as per-import. The question the limit answers is "how much is this journal
holding in staging, across everything", so the sum is over every run the journal
owns. `runBytes` sums one run; the total wants its own helper beside it, so there
is one answer rather than a sum assembled at each call site.

Name the constant for what it means. A constant reading `PER_RUN` while enforced
per journal is the kind of lie that survives for years.

**A consequence worth designing for rather than tolerating:** a person can be
refused an upload because of photographs they forgot about. That is correct — it
is their disk either way — but the refusal has to point somewhere. "No room" with
no route out is a dead end; "no room, and two other imports are holding 8 GB" is
actionable, because B1805's destroy control is right there.

Put it where the other media limits live — `lib/validate/media.ts` — rather than
inventing a second home. `runBytes(username, runId)` in `lib/staging/store.ts:66`
already sums a run.

**Refuse honestly at the boundary.** The upload route already rejects a file
that is too large with a reason; a batch that would cross the run's ceiling gets
the same treatment. **Accept what fits and refuse the rest**, rather than
failing the whole batch — somebody who selects 400 photographs and crosses the
line at 380 should keep the 380. The route's `rejected` list already carries a
per-file reason and the page already renders one.

**Show it before they hit it**, two places:

1. **The limits table on the choosing screen**, beside "Up to 500 at a time" and
   "Each one under 50 MB". This is the screen that exists to state limits before
   the picker opens.
2. **A bar on the upload screen and on the resume card**, in the same visual
   language as B1806's countdown bar — `2,3 GB von 10 GB`. The two bars answer
   the two questions a staged import raises: how long have I got, and how much
   room is left.

Two bars on one card is a real risk of noise. **They must not read as the same
kind of thing** — different placement, different weight, and the storage one
only when it is worth mentioning. Consider showing it only past some fraction of
the ceiling; an import at 2% does not need a bar telling it so, and a person who
never approaches the limit should never see it.

## Acceptance

- An import cannot exceed 10 GB; a batch that would cross it stages what fits
  and refuses the rest with a reason the page shows.
- The ceiling appears in the choosing screen's limits table.
- Where the usage is shown, it is a real figure from `runBytes`, not an estimate
  from file sizes the browser reported.
- A person under a small fraction of the ceiling is not shown a storage bar at
  all — say in the report what threshold you chose and why.
- Real en/de/hu, with the size formatted per locale (`formatBytes` exists in
  `lib/storageQuota.ts:83` — check whether it localises before reusing it).
- Verified at 390px in both themes with a run that is near the ceiling.

## Related

Shares a card with B1806's countdown and should be built with it so two writers
do not collide. The ceiling itself is independent of that work.
