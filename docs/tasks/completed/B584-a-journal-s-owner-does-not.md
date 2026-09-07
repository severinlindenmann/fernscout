---
id: B584
title: The instance admin sees an empty trips page and is told the trip is `listed: false`
type: ISSUE
priority: high
complexity: low
area: trips, access
found: "2026-09-06T14:10:04Z"
merged: "2026-09-06T14:17:49Z"
completed: "2026-09-07T13:12:14Z"
---

# B584 — The instance admin sees an empty trips page and is told the trip is `listed: false`

## Why

`listableTrips` (lib/tripGate.ts) never asked `isOwner`. It let a journal's
own owner through only by accident — `peopleNamedIn` heads every trip's
`people:` with the owner's address, so `isPersonOnWith` says yes — and nothing
put the instance admin's address (`FERNSCOUT_ADMIN_EMAIL`, B480) anywhere.
`mayReadTrip` has asked `isOwner` since B480, so the admin could open every
trip and see none listed.

Seen on fernscout.ch: `/severin/trips` signed in as `agent@fernscout.ch`
answered with the B270 empty state — "you have a trip, but it is marked
`listed: false`" — about `severin/algarve-2026`, which is `private` and which
that reader could open.

## Work

Ask `isOwner(username)` once in `listableTrips`, and only when the list holds
a trip that is not public. `listed: false` still hides a public trip from
everybody. `test/admin-lists-trips.test.ts` is the case, mocked at the two
session questions.

## Acceptance

`npx vitest run test/admin-lists-trips.test.ts` — fails before, passes after.
On fernscout.ch, `/severin/trips` as the admin lists Algarve 2026.
