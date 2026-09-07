---
id: B536
title: Only two write routes check their body against the published contract
type: CHORE
priority: medium
complexity: medium
area: api, validation
found: "2026-09-06T12:10:00Z"
started: "2026-09-06T10:32:24Z"
merged: "2026-09-06T10:48:04Z"
completed: "2026-09-07T13:11:45Z"
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

## Done as part of B540

Nothing was left to do by the time this was taken. B540 documented every route
while making the contract executable, so `WITHOUT_A_SCHEMA` in
`test/api-route-schemas.test.ts` is empty and asserted empty, and
`test/openapi-contract.test.ts` fails on any `/api/v1` or `/api/auth` route+verb
that is not in the document. The sixteen routes this ticket listed all have a
`requestBody` schema and all call `checkBody` through the published document.

Kept rather than superseded: the acceptance below is exactly what those two
tests assert, so this is a thing to verify rather than a thing to abandon.

## Acceptance

- Every `/api/v1` route that reads a body has a `requestBody` schema and calls
  `checkBody`.
- `WITHOUT_A_SCHEMA` in `test/api-route-schemas.test.ts` is empty.
- A misspelled key on `PATCH .../visibility` answers 400 and changes nothing.
- `npm run verify` green.
