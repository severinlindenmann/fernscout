---
id: B209
title: Two different limits are refused with the same sentence, so an agent cannot tell which it broke
type: ISSUE
priority: low
complexity: low
area: media, api
found: "2026-09-04T06:14:20Z"
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

## Work

Give the two different sentences. The batch one is about the request; the
ceiling one is about the day. Neither number changes, only the words.

Check `/agent.md`'s limits table while in there — it advertises "at most 40
items per day", which is the second rule, and does not mention the first.

## Acceptance

- The two refusals read differently and each says what to do next.
- A test asserts both, matched on their text rather than on their position in
  `problems` (see B71).
