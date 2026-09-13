---
id: B1652
title: GET /api/v2/{user} leaks owner.email and the whole journal document to a trip-scoped token
type: SECURITY
priority: high
complexity: low
area: API v2
found: "2026-09-13T09:08:50Z"
---

# B1652 — GET /api/v2/{user} leaks owner.email and the whole journal document to a trip-scoped token

## Why

`GET /api/v2/[user]/route.ts:31-43` authenticates the bearer and checks
`ownsUser` (does this token belong to this journal at all) but never calls
`mayActAsOwner` — unlike its own `PATCH` and `DELETE` a few lines below,
both of which gate on it. `ownsUser` is true for a trip-scoped token (it
belongs to the journal, just scoped to one trip inside it), so a token
minted for a single buddy trip can `GET /api/v2/{user}` and read the whole
journal document back — including `owner.email`, per `journalV2Fields`
(`lib/journals.ts:1413-1426`), which always includes it.

Verified empirically while working B1632: a trip-scoped agent token reads
`{"title":"Ana","owner":{"name":"A","nickname":"A","email":"ana@example.test"},...}`
with a plain `200` from `GET /api/v2/ana`.

This is the same mistake B231/B1086 already found and fixed once, in the
same idiom, one door over: "the route decided who read on `ownsUser`,
which asks only which journal the token belongs to and never what it may
do inside it." v1's `GET /api/v1/{user}/config` (retired under B1632)
explicitly excluded `owner.email` from its response for exactly this
reason and required `mayActAsOwner` before returning anything at all — see
the deleted route's own comment, quoted in B1632's report: "reading a
journal's config is not permission to collect its owner's email, and the
whole point of the scope line the client prints is that this one field can
never be compared." v2's `[user]` GET carries no equivalent restriction.

Pre-existing in the codebase (B1608, phase 2 step 3) — not introduced by
B1632, which only read this file, never edited it.

## Work

Not this ticket's to fix, but the shape of the fix is narrow:
- Add a `mayActAsOwner` gate to `GET /api/v2/[user]/route.ts`'s `GET`,
  matching its own `PATCH`/`DELETE` a few lines below — OR
- If a trip-scoped token is meant to read *something* about the journal
  it is scoped into (a real product question, not this ticket's to answer),
  strip `owner.email` from what a non-owner reader gets back, the way v1's
  `config` route did.
- Either way, `test/api-v2-journal.test.ts` wants a case for a trip-scoped
  token's `GET`, the same shape `test/scope-escalation.test.ts` already
  carries for `export.zip` and used to carry for `config`.

## Acceptance

A trip-scoped agent token's `GET /api/v2/{user}` either answers something
narrower than the full document, or is refused outright (403) — and in
neither case does the response body contain `owner.email`.
