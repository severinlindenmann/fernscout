---
id: B98
title: Revoking somebody's access leaves every agent token already issued to them working until it expires
type: SECURITY
priority: medium
complexity: medium
area: auth, contacts, api
found: "2026-09-03"
started: "2026-09-03"
merged: "2026-09-03"
completed: "2026-09-04T21:54:15Z"
---

# B98 — Revoking somebody's access leaves every agent token already issued to them working until it expires

Found while building B33. Not caused by it — the same hole is there for a name
removed from `people:` by hand — but B33 is what makes it matter, because
revoking is now a thing an owner does with one click and expects to have
happened.

## Why

Access is decided in two places that do not know about each other.

**At read time**, `mayReadTrip` and `isPersonOn` ask the database on every
request, so a revocation is immediate: `revokeContact` deletes the
`access_grants` row and marks every `trip_people` row revoked, and the next
page load says no.

**At write time**, it is not asked at all. `mayWriteTrip` (`lib/api/auth.ts`)
checks only `scopeAllows(session.scope, trip)` — a string, `write:trip:<id>`,
baked into the `sessions` row when the token was minted and never re-checked
against anything. `revokeContact` and `deleteContact` do not touch `sessions`,
and neither does removing somebody from `people:`.

So: somebody comes on a trip, gets an agent token, and is then removed —
blocked, deleted, or taken off the trip. Their token keeps writing days into
that trip for the rest of its **seven days**. The owner has been shown a
confirmation, the reader has stopped being able to read, and the write API has
not noticed.

Seven days is the whole exposure, which is why this is medium rather than high.
What makes it worth fixing anyway is that the owner has no way to *tell*: there
is no listing of live sessions anywhere, so somebody who revokes access in a
hurry — the exact case B33's revoke button exists for — cannot find out that a
credential is still out there, let alone stop it.

Note the contrast that makes this look like an oversight rather than a trade:
`/api/auth/request` refuses to *issue* an agent code to an address that is not
the owner and not on the trip. The check exists and is enforced once, at the
door, and then never again for the life of the token.

## Work

- Re-check membership at use, not only at issue. `mayWriteTrip` is the one
  chokepoint (`lib/api/auth.ts`), and `scopeAllows` in `lib/mcp/tools.ts` is the
  other. A trip-scoped session should be measured against `isPersonOn` — which
  since B33 is already async and already merges the file with the granted rows
  — rather than against a string frozen a week ago. The owner's unqualified
  `write:content` needs no lookup and should not get one: it is a query per API
  call on the commonest path.
- Or revoke the sessions instead, which is cheaper at request time and worse at
  everything else: `revokeContact`, `deleteContact`, `updateContactByOwner`'s
  email change and `revokeTripPlaces` would each have to remember, and a name
  removed from `trip.md` by hand has nothing to hang a revocation off at all.
  That last case is the argument for checking at use.
- Whichever way: decide what an already-issued token should answer, and say it
  in words. `401 invalid_token` reads as "ask for a new code", which is exactly
  wrong — they will ask, and `/api/auth/request` will refuse them. `403` naming
  the reason is the honest answer.
- `lib/deletions.ts` sweeps `sessions` for a journal deletion already; check
  whether deleting a *trip* should sweep the tokens scoped to it.

## What was built

The first option: **checked at use**, not swept at revocation.

`tripWriteVerdict(scope, email, trip)` in `lib/tripPeople.ts` is the whole
decision, and it returns three answers rather than a boolean — `allowed`,
`out_of_scope`, `revoked`. The owner's unqualified `write:content` returns
`allowed` before anything is looked up. A scope naming a *different* trip
returns `out_of_scope` on the string alone, also without a query. Only a scope
naming *this* trip reaches `isPersonOn`, which since B33 already merges the
file with the granted rows — so the file's `people:` block and a revoked
`trip_people` row are both covered by one lookup.

Sweeping `sessions` at revocation was rejected for the reason the Work section
suspected: a name deleted from `trip.md` in an editor has no request, no row
and no code path to hang a sweep off. Every mechanism that can revoke would
have had to remember, and the one that cannot be made to remember is the one
the author uses.

**Three answers, because they must not be one.** `out_of_scope` has to be
indistinguishable from "no such trip" — the routes answer `404 unknown_trip`
for both, or a trip-scoped token could enumerate a journal by guessing ids,
which `/agent.md` explicitly promises it cannot. `revoked` is the exception and
answers `403 access_revoked`: the token already names that one trip, so the
reason gives nothing away.

The wording matters as much as the status. `invalid_token` says *"ask for a new
code at POST /api/auth/request"*, which is precisely wrong here — they would
ask, and that endpoint would refuse them for the same reason. `access_revoked`
says the owner withdrew access and that a new code will not be issued either.
It is in the guide's error table too (`lib/api/documentation.ts`).

Both doors were changed. `mayWriteTrip` (`lib/api/auth.ts`) is now async and
returns the gate rather than a boolean, with `refuseWrite()` building the
response; the six REST call sites split their old `!found || !mayWriteTrip(…)`
into a 404 for the missing trip and the gate for the rest. `resolveTrip` and
`reachableTrips` in `lib/mcp/tools.ts` ask the same function, so a revoked
person is refused over MCP and the trip stops being listed at all — refusing a
write on a trip still shown in `list_trips` would be a worse answer than not
showing it.

**Deleting a trip does not need a session sweep** (the last Work bullet). With
the check at use, a deleted trip is one `getTrip` no longer returns, and every
route answers `404 unknown_trip` before the gate is consulted. Nothing to
revoke.

### Evidence

`test/write-revocation.test.ts` is end to end through the real route, and both
of its revocation tests **fail against the previous code with `expected 201 to
be 403`** — which is the bug itself: the write succeeded. One covers a name
deleted from `people:` by hand, one covers `revokeContact` on an approved
contact. `test/mcp.test.ts` gains the same assertion for the MCP door, and it
also fails against the previous code. `test/trip-write-verdict.test.ts` mocks
`lib/db` and asserts the owner's path makes **zero** `getDatabaseOrNull` calls,
so "costs no extra query" is asserted rather than reasoned about.

## Acceptance

- A trip-scoped token stops writing to its trip the moment the person is
  revoked, asserted end to end: issue a token, revoke the contact, and the next
  write is refused without waiting for the token to expire.
- The same for somebody removed from a trip's `people:` block by hand.
- The refusal says why, and does not tell the caller to fetch a new code that
  will not be issued.
- The owner's own `write:content` token costs no extra database query per call.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.
