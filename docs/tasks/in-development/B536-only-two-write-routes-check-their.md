---
id: B536
title: Only two write routes check their body against the published contract
type: CHORE
priority: medium
complexity: medium
area: api, validation
found: "2026-09-06T12:10:00Z"
started: "2026-09-06T10:32:24Z"
session: 73b1a7f5-30ec-425d-9dbf-4d423e411c0d
claimed: "2026-09-06T10:32:24Z"
---

# B536 — Only two write routes check their body against the published contract

## Why

B535 builds `checkBody` and wires it into `POST .../trips` and `POST
.../days`. Sixteen other `/api/v1` routes read a JSON body and still drop
what they do not recognise:

    config  channels  invites  keys  postcards  credits/purchase
    payments/[id]/approve  payments/[id]/pay  journals
    trips/[trip]/costs  .../days/[slug]  .../media  .../people
    .../rates  .../travellers  .../visibility

The one-field doors — `visibility`, `rates`, `people`, `travellers` — are the
ones that matter most and the ones nobody notices: their whole purpose is to
change one thing, so a misspelled key means the call did nothing at all and
answered 200.

Separate from B535 because it is a sweep, not a design, and because the sweep
is only safe once the mechanism has been through `testing/` on two routes.

## Work

- Add the seven missing routes to `lib/api/openapi.ts`, and give every route a
  `requestBody` schema matching what the handler actually accepts. Reading each handler to
  write its schema is most of this task, and is the point: it is the first
  time the accepted fields have been written down.
- Wire `checkBody` into each, after auth and after the resource-exists check.
- Delete the ad-hoc key-picking each handler does by hand where the checker
  now covers it.
- The route-has-a-schema test from B535 goes from listing uncovered routes to
  passing with none.

Not doing: `/api/auth/*`, `/api/contacts/*`, `/api/push/*`, `/api/reactions`.
Browser flows, different callers, different threat model. Own capture if the
same failure shows up there.

## Acceptance

- Every `/api/v1` route that reads a body has a `requestBody` schema and calls
  `checkBody`.
- `WITHOUT_A_SCHEMA` in `test/api-route-schemas.test.ts` is empty.
- A misspelled key on `PATCH .../visibility` answers 400 and changes nothing.
- `npm run verify` green.
