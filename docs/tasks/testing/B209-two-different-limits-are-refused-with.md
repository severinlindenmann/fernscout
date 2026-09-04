---
id: B209
title: Two different limits are refused with the same sentence, so an agent cannot tell which it broke
type: ISSUE
priority: low
complexity: low
area: media, api
found: "2026-09-04T06:14:20Z"
started: "2026-09-04T07:52:18Z"
merged: "2026-09-04T08:19:52Z"
---

# B209 — Two different limits are refused with the same sentence, so an agent cannot tell which it broke

## Why

Noticed while fixing B71, which is about the *order* of the same array.

Two unrelated checks produce the same `expected` sentence:

- `validateMediaBatch` (`lib/validate/media.ts:135-140`) — "you sent more than
  40 items in this one request" — `{ field: "media", got: "41 items",
  expected: "at most 40 per day" }`.
- `storeUploads` (`lib/api/media.ts:226-232`) — "this day already holds 40" —
  `{ field: "files", got: "41 items in this day", expected: "at most 40 per
  day" }`.

The `expected` string is identical and `got` differs only in a trailing
phrase. An agent reading the refusal cannot tell "send fewer per request" from
"this day is full, use another day" — and those have different remedies. The
`field` does distinguish them, but `"media"` and `"files"` are not words that
say which is which either.

Costs a wasted retry: an agent that splits the batch in half and resends gets
the same refusal, because the day was already full.

**Corrected while building: the two checks are not "unrelated", and that
changes what the batch sentence may say.** The day ceiling counts
`existing + uploads.length` where `existing` is a `readdirSync` count and is
never negative, so it fires whenever the batch rule does. The two problems
therefore always arrive *together*, and the obvious wording for the batch one —
"send fewer per request" — would have been advice that cannot work: a batch too
big for one request is too big for the day however it is split. The wasted
retry the Why describes is exactly that advice being followed.

So the batch sentence says what the request broke *and* refuses the remedy that
does not work. The redundancy itself — one mistake, two problems — is left
alone here and captured as **B229**.

## Work

Give the two different sentences. The batch one is about the request; the
ceiling one is about the day. Neither number changes, only the words.

Check `/agent.md`'s limits table while in there — it advertises "at most 40
items per day", which is the second rule, and does not mention the first.

## What was built

- `validateMediaBatch` (`lib/validate/media.ts:133`) now reports
  `got: "41 items in one request"` and an `expected` that names the request,
  says the same number is all a day may hold, and says splitting will not help.
- `storeUploads` (`lib/api/media.ts:232`) reports `got: "41 items in this day"`
  and an `expected` that names what the day already holds, how much room is
  left, and "put the rest on another day". The remaining room is computed, so
  the sentence is actionable rather than generic.
- The guide's limits table (`lib/api/documentation.ts:957`) gains a `per
  request` row saying it is the same number and that splitting will not help,
  beside the per-day row it already had.
- Tests: `test/validate-media.test.ts` asserts the request sentence and that it
  does not borrow the day's words; `test/media-upload.test.ts` asserts the pair
  in one refusal from the real writer, matched on text (B71).

## Acceptance

- The two refusals read differently and each says what to do next. ✅
- A test asserts both, matched on their text rather than on their position in
  `problems` (see B71). ✅ — `only(...)` in `test/media-upload.test.ts` matches
  on `"in one request"` and `"in one day"` and asserts exactly one of each.
