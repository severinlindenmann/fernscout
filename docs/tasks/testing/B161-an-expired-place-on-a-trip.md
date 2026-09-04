---
id: B161
title: An expired place on a trip is not restored by re-approving the contact
type: ISSUE
priority: low
complexity: low
area: contacts, trips, grants
found: "2026-09-03T19:34:44Z"
started: "2026-09-04T07:30:31Z"
merged: "2026-09-04T07:57:03Z"
---

# B161 — An expired place on a trip is not restored by re-approving the contact

## Why

Found while fixing **B130**, in the other table, and deliberately not absorbed
into it: B130 is `access_grants` and this is `trip_people`. Same rule, same
failure, different file — which is exactly the shape of thing that gets fixed
once and left standing everywhere else, so it gets its own id rather than a
quiet extra hunk in somebody else's diff.

`approveTripPlaces` (`lib/tripPeople.ts:286`) selects the rows it is going to
open by asking whether they were ever opened:

```ts
.where("granted_at", "is", null)
.where("revoked_at", "is", null)
```

A place whose `expires_at` has passed fails that filter — it *was* granted —
so the approval passes over it. The readers do not: `lib/tripPeople.ts:114`
and `:145` both run `grantIsLive`, so an expired row is no place at all. The
owner clicks approve, `approveContact` reports success, and the person is
still not on the trip.

This is the same divergence B82 found in `lib/push.ts` and B130 found in
`approveContact`: one writer testing for a row's *existence* while every
reader tests whether it is *live*. `lib/grants.ts` exists to be the single
answer, and `approveTripPlaces` is the last caller in the codebase that does
not ask it.

As with B130 this cannot be reached today, because nothing writes a non-null
`expires_at` to either table — `claimTripPlace` (`lib/tripPeople.ts:239`)
hard-codes `expires_at: null`. It becomes live the moment a time-limited
buddy link ships.

**Not the same question:** a place carrying `revoked_at` is also skipped, and
that is arguably correct — `revokeTripPlaces` documents marking rather than
deleting so somebody blocked cannot redeem the same link back into a clean
slate. Whether re-approving a revoked contact should put them back on their
trips is a decision about what revocation means, not a bug in this filter.
Say which of the two this task is fixing before starting; the expiry half is
the unambiguous one.

## Work

- Widen the selection so a row that is granted, unrevoked and *expired*
  is opened again — clearing `expires_at` and restamping `granted_at` /
  `granted_by`, matching what B130 did to `access_grants` so the two tables
  behave the same way under one click.
- Ask `grantIsLive` rather than re-deriving the comparison, so this file joins
  the readers already importing it three lines above.
- Not doing: the `revoked_at` question above, and not issuing time-limited
  places at all — there is still no caller that sets an expiry.

## Acceptance

- A `trip_people` row with `granted_at` set, `revoked_at` null and
  `expires_at` in the past, put back through `approveContact`, comes back live:
  `peopleOf()` lists them on the trip and `mayReadTrip` opens it.
- Approving does not disturb a row that is already live — no restamping of a
  grant that never lapsed, and no second row.
- A test in `test/trip-people.test.ts` that fails before the change, reaching
  into the row the way the B130 case in `test/access-gate.test.ts` does.
- The four checks.

## What was built

**The expiry half, and only that.** `approveTripPlaces` (`lib/tripPeople.ts`)
now selects every unrevoked row for the contact and asks `grantIsLive` which of
them are not currently a place — never granted, or granted and since lapsed.
Those are opened together: `granted_at` and `granted_by` restamped and
`expires_at` cleared, which is exactly what B130 did to `access_grants`, so one
click behaves the same way on both tables. A row that never lapsed is not
touched, and the returned trip ids are the ones actually opened.

The Why above was checked against the code and stands. Two things it did not
know, both confirmed rather than contradicted:

- **B178 decided the standing of the expiry column** (`grantIsLive`, in
  `lib/grants.ts`): a grant is permanent until revoked, no writer takes an
  expiry, and the column stays and stays enforced so that "let them in until
  Christmas" is one writer away. This change is the same position for
  `trip_people` — it does not create expiries, it makes the one writer that
  ignored them agree with every reader. Nothing here contradicts B178.
- **The `revoked_at` question named in the Why is deliberately left alone**, and
  is now pinned by a test rather than by absence: a revoked place stays revoked
  when the contact is approved again. `revokeTripPlaces` marks rather than
  deletes so somebody shown the door cannot redeem the same link into a clean
  slate, and a widening of this filter should have to argue with a failing test.

`approveContact` remains the only thing that creates a place; nothing new
writes one.

## One correction to the Acceptance

The test is in **`test/trip-place-revival.test.ts`**, not in
`test/trip-people.test.ts`. That file states in its own words that it sets **no
`DATABASE_URL`, deliberately** — what it pins is that a hand-written `people:`
block stands entirely on its own with no database at all — so giving it a
database to reach into would dissolve the property it exists to assert.

## Evidence

`npx vitest run test/trip-place-revival.test.ts`: 4 passed. Against the previous
`approveTripPlaces`, 2 of the 4 fail — the revived place is not returned and
`isPersonOn` stays false after the owner has clicked approve.

The four checks: `npm run build`, `npx tsc --noEmit`, `npx eslint .` (0 errors),
`npx vitest run` (130 files, 2098 passed, 2 skipped).
