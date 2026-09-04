---
id: B213
title: Re-approving a revoked contact restores the journal but not their place on a trip, and says it worked
type: ISSUE
priority: high
complexity: low
area: contacts, trips, grants
found: "2026-09-04"
started: "2026-09-04T08:39:10Z"
session: 7d30451d-0304-4631-8484-d96036fb11b4
claimed: "2026-09-04T08:39:10Z"
---

# B213 — An un-revoke that only half works, and reports success

## Why

Found while verifying B98 on the live instance. B98's own behaviour is correct —
revoking a contact kills their trip-scoped token immediately, on both doors.
This is what happens when the owner changes their mind.

Observed end to end on `xydhd-qa1`, contact `278ac66d-…`
(`xydhd-b33buddy@severin.io`), holding a buddy place on trip `b33-buddy`:

```
POST /api/contacts/admin {"action":"revoke","id":"278ac66d-…"}  -> 200 "blocked"
POST /api/contacts/admin {"action":"approve","id":"278ac66d-…"} -> 200 {"ok":true,
                                                    "contact":{…,"status":"active"}}

POST /api/v1/xydhd-qa1/trips/b33-buddy/days   (their token)     -> 403 access_revoked
GET  /api/v1/xydhd-qa1/trips                  (their token)     -> {"trips":[]}
```

The contact is `active` again and reads the journal's `guest` trips again. Their
**place on the trip is gone for good**, and the approve call said `ok: true`.

### Corrected while building — the Why above was written against older code

B161 merged to `main` two hours after this was captured and rewrote the exact
function, so two of the three bullets that were here were describing code that
no longer exists. What they said, and what is true:

- ~~`approveTripPlaces` selects with `.where("granted_at","is",null)`~~. Not
  since B161. It now selects every unrevoked row and filters in memory on
  `granted_at === null || !grantIsLive(...)`, so a *lapsed* place is revived.
  The `.where("revoked_at","is",null)` half was still there and was still the
  whole of this bug, but "the filter is a test for existence" was B161's
  diagnosis and had already been fixed.
- ~~`revoked_at` is cleared nowhere~~ was true and is the real cause, and it
  survives the rewrite unchanged.
- **The recovery paragraph was wrong, and in the reassuring direction.**
  Issuing a new buddy link does *not* restore the place. `claimTripPlace`
  (`lib/tripPeople.ts:255`, after this change) returns early when **any** row
  exists for `(owner, trip, contact)` — revoked included — so redeeming a
  fresh link writes nothing at all. Nor can the person redeem anything while blocked —
  `requestContact` answers `ignored` first. There was no route back through any
  product surface: the place could only be restored by editing the database.
  That, more than the misreported `ok`, is what settled the decision below.

So the cause is one line. `revokeTripPlaces` (`lib/tripPeople.ts:414` after
this change) stamps `revoked_at`, `approveTripPlaces` (`lib/tripPeople.ts:355`)
filtered those rows out, and nothing anywhere clears the stamp. The row
survives, permanently closed, and no surface says so.

**This is reachable in two clicks**, which is what separates it from its
neighbours. It is the same shape as **B130** in the other table — a row that
exists but is not live — and the same shape as **B161**, but B161 concerns an
*expired* place, which nothing on the instance can currently produce. This one
is what an owner who revokes somebody by mistake hits immediately.

## The decision: revocation is reversible, by the owner and by nobody else

B161 declined to touch a revoked place and said why: revocation marks rather
than deletes so somebody shown the door cannot redeem the same link back into a
clean slate, and "whether revocation should be reversible at all is a decision
about what revocation means, not this filter's business." That decision is
this ticket's, and it is: **yes, and only the owner may make it.**

Four things decided it.

1. **Not reversing it is not an option that exists.** The alternative end —
   the place deliberately stays closed and the response says so — has to name
   how to give it back, and there is nothing to name. See the recovery
   correction above. Building one would mean adding an owner-initiated
   restore, which *is* revival with a second button in front of it, and
   `approveContact` already argues in its own words against that shape: "a
   second button they could forget would leave somebody who followed a buddy
   link approved as a reader and silently still not on the trip." That is a
   description of this bug.
2. **The neighbouring table already answers this, and has since B33.**
   `revokeContact` **deletes** the `access_grants` row and `approveContact`
   writes a fresh one, so at journal level revoking has always been fully
   reversible on one click — the re-approved contact reads every `guest` trip
   again. Trip places were the only thing that did not come back, by a filter's
   accident rather than by anyone's argument, and one writer disagreeing with
   its neighbour is the single defect shape this codebase keeps re-finding
   (B82, B130, B161).
3. **The delta is smaller than what was already restored.** Approving a blocked
   contact hands back read access to the whole journal. Adding "and the one
   trip they were already on" to that is not the escalation it looks like.
4. **The risk B161 named is real and is kept — where it is actually enforced.**
   A revoked person must not be able to redeem their way back to a clean slate,
   and they cannot, at three independent points: `requestContact` refuses a
   `blocked` contact before anything is written, so a re-redemption never
   reaches `claimTripPlace` and never lands in the owner's queue;
   `claimTripPlace` returns on the existing row, so no second clean row can be
   made even after the contact is active again; and `approveContact` is the
   only thing in the codebase that writes `status: "active"` at all
   (`lib/contacts/session.ts:76`). The filter in `approveTripPlaces` was never
   what enforced this; it only looked as though it was.

**What is deliberately still missing**, and is captured rather than absorbed:
the approve response still never names the trips the approval opened, even
though `approveTripPlaces` returns them for exactly that purpose and
`approveContact` drops the array. That was already true for an ordinary pending
buddy request, has nothing to do with revocation, and touches the response
contract, the panel and the i18n strings. **B244.**

## Work

- `approveTripPlaces` revives a revoked row rather than skipping it: `revoked_at`
  is dropped from the `where`, `revoked_at !== null` becomes its own reason to
  open a row — such a row usually carries a live `granted_at` and no expiry, so
  neither of the other two clauses would select it — and the update clears
  `revoked_at` along with `expires_at`. Same shape as B130's revival in `access_grants`.
- The reasoning moves to the three places that enforce it: `claimTripPlace`'s
  early return is documented as load-bearing, `revokeTripPlaces` says it is
  reversible by the owner, and `approveContact`/`revokeContact` say the same
  from the contacts side.
- Two tests, both failing before the change: the round trip at library level in
  `test/trip-place-revival.test.ts` (replacing B161's "stays revoked", which
  asserted the behaviour this ticket reverses), and the same round trip through
  the real route with the same trip-scoped token in
  `test/write-revocation.test.ts` — the assertion B98's suite stopped short of.
  Plus the half that must not change: a revoked holder redeeming the same buddy
  link again, end to end through `/api/contacts/redeem`, writes nothing.
- Not doing: naming the opened trips in the approve response (B244), and
  nothing to `lib/grants.ts` — see below.

**The neighbouring table, checked.** `access_grants` does not have this bug and
does not need a capture. `revokeContact` deletes the rows and `approveContact`
re-inserts, so revocation there is already reversible; B130 fixed the adjacent
case (a row that exists but has expired) in the same function. After this change
the two tables agree under one click, which is the divergence that bit twice.

**Other `revoked_at is null` filters, checked.** Three, and all three are
right. `redeemedPeopleOf` and `redeemedTripsFor` are readers and must exclude a
revoked place. `revokeTripPlaces`'s own guard is what keeps `revoked_at` meaning
the first time the owner said no, rather than being pushed forward by a second
revocation — asserted by the second round trip in the new test.

## Acceptance

- Revoke then re-approve leaves the contact and their trip place in a state the
  approve response accurately describes.
- If the place is restored, their trip-scoped token writes again without a new
  invite. If it is not, the response says the place was not restored and names
  how to give it back.
- A test covers the round trip end to end.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.
