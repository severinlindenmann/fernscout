---
id: B1496
title: A trip's translations can be set once and never corrected
type: ISSUE
priority: low
complexity: low
area: trips, api
found: "2026-09-11T17:40:00Z"
---

# B1496 — A trip's translations can be set once and never corrected

## Why

Found while researching B1495. B245 closed the "trip.md cannot be changed"
family, and `PATCH /api/v1/<user>/trips/<trip>` (`lib/api/tripDetails.ts`) now
carries `title`, `tagline`, `start`, `end`, `cover`, `accent`,
`costsVisibility` and `intro`. `translations` is the one field of the eleven
`POST .../trips` accepts that still has no way back: it is writable at create
(`translationsBlock`, `lib/tripWrite.ts:632`), readable afterwards
(`app/api/v1/[user]/trips/[trip]/route.ts:54`, B540), and correctable nowhere.

A typo in a trip's German title is therefore permanent over the API, which is
the exact shape B245 existed to end — and it matters more than most, because
whoever reads that title is reading it in their own language and cannot see
the English one to know it is wrong.

It also blocks B1495's up leg from being a faithful mirror: a `translations:`
block edited in a local `trip.md` cannot reach the site.

## Work

Add `translations` to `patchTripDetails` — the same door, not a new route,
for the same reason `cover` went there. It is a block rather than a line, so
it splices like `translationsBlock` already does on create; reuse that
function rather than writing a second serialiser. Decide whether an empty
object clears the block (the `null`/`""` convention the other optional fields
use) and document the answer.

`lib/api/openapi.ts` gets the field on the PATCH schema.

## Acceptance

- A trip created with a typoed German title can be corrected through
  `PATCH /api/v1/<user>/trips/<trip>` and read back through the same route's
  `GET`.
- An invalid block is refused with `invalid_translations`, the same error
  create gives.
- A locale the journal does not declare is handled the same way create handles
  it, with a test pinning that the two agree.
- `npm run verify` green; the field is in the PATCH schema in `/openapi.json`.
