---
id: B229
title: The per-request media limit cannot be broken without the per-day ceiling breaking too, so one oversized batch is refused twice
type: ISSUE
priority: low
complexity: low
area: media, validation
found: "2026-09-04T07:58:23Z"
started: "2026-09-07T10:37:39Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T10:37:39Z"
---

# B229 — The per-request media limit cannot be broken without the per-day ceiling breaking too, so one oversized batch is refused twice

## Why

Found while fixing B209, which is about the two refusals reading identically,
and deliberately not absorbed into it: B209's Work says "neither number
changes, only the words", and this is a question about whether one of the two
rules should exist at all.

`validateMediaBatch` (`lib/validate/media.ts:133`) refuses when
`items.length > limits.itemsPerDay`. `storeUploads` (`lib/api/media.ts:232`)
refuses when `existing + uploads.length > limits.itemsPerDay`, where `existing`
is a `readdirSync` count of the day's media directory and is therefore never
negative. So **the second condition is implied by the first**: every batch that
breaks the request rule also breaks the day rule, and an agent that sends 41
files to an empty day gets two entries in `problems` about one mistake.

`storeUploads` is `validateMediaBatch`'s only production caller — ingest uses
`validateMediaItem` per file (`lib/ingest/index.ts:243`) and never the batch
function — so there is no caller for which the request rule is the only one
in force.

B209 made the two sentences say different things and told the truth about the
remedy, so the refusal is no longer misleading. What is left is that it is
redundant: two problems, one cause, and a request-level cap that has never
independently refused anything.

## Work

- Decide whether the request rule is a rule at all, or an artefact of
  `validateMediaBatch` having been written before `storeUploads` existed (the
  header comment in `lib/validate/media.ts` still says ingest is its one
  caller, which is no longer true of the batch function).
- If it stays, give it a number of its own — a genuine per-request cap, below
  the day's, would make it a rule that can fire alone and would give
  "split the batch" back its meaning.
- If it goes, `validateMediaBatch` becomes "every item's problems" and the day
  ceiling in `storeUploads` is the only place a count is judged. Check what
  `test/validate-media.test.ts` and the agent guide's limits table say
  afterwards; both were updated for B209 and would need updating again.

Not this task: the wording of either refusal. B209 did that.

## Acceptance

- One oversized batch produces one problem about the count, not two — or the
  file records the decision that both should stay and why.
- `/agent.md`'s limits table matches whatever is decided.

## Resolution

Confirmed `storeUploads` is `validateMediaBatch`'s only production caller
(ingest uses `validateMediaItem` per file) and that `existing` in
`storeUploads` (`readdirSync(mediaOut).length`) is never negative — so
`items.length > limits.itemsPerDay` is never true without
`existing + items.length > limits.itemsPerDay` also being true, including on
the first upload of an empty day (`existing === 0`, where the two conditions
coincide exactly).

Decided: the request rule goes. Removed the count check from
`validateMediaBatch` (`lib/validate/media.ts`), which is now every item's own
problems and nothing else; the day ceiling in `storeUploads`
(`lib/api/media.ts`) is the only place a count is judged.

Updated `/agent.md`'s limits table (`lib/api/documentation.ts`): the "per
request" row no longer states an item count (there is none any more) and now
only carries the body-size ceiling; the "per day" row keeps the "splitting
will not help" note that used to live on the request row, since that is still
true and now has nowhere else to live.

Updated the two tests that asserted the old behaviour:
`test/validate-media.test.ts` ("too many items for one day is its own
problem" and the B209 pair test) replaced by one test asserting
`validateMediaBatch` returns no count problem at all for an oversized batch;
`test/media-upload.test.ts`'s "a batch bigger than a day says both what the
request broke and what the day holds" rewritten as "...says what the day
holds, once", asserting exactly one problem naming the count. Both fail
against the pre-fix code (which asserted two problems, one from each rule).

`npm run verify` green (see final report).
