---
id: B213
title: Re-approving a revoked contact restores the journal but not their place on a trip, and says it worked
type: ISSUE
priority: high
complexity: low
area: contacts, trips, grants
found: "2026-09-04"
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

The cause is in two lines that do not know about each other:

- `revokeTripPlaces` (`lib/tripPeople.ts:325`) stamps `revoked_at` on the row.
- `approveTripPlaces` (`lib/tripPeople.ts:288-296`) selects the rows to open with
  `.where("granted_at","is",null).where("revoked_at","is",null)` — so a stamped
  row is passed over entirely.
- Grepping `lib/` and `app/` finds `revoked_at: null` written **only at insert**
  (`lib/tripPeople.ts:267`). Nothing ever clears it.

So the row survives, permanently closed, and no surface says so. The owner is
told the person is back; the person still cannot write; neither is told why.

**This is reachable in two clicks**, which is what separates it from its
neighbours. It is the same shape as **B130** in the other table — a row that
exists but is not live — and the same shape as **B161**, but B161 concerns an
*expired* place, which nothing on the instance can currently produce. This one
is what an owner who revokes somebody by mistake hits immediately.

The recovery is worse than the bug. The buddy link that created the place is
single-use per person and the place cannot be re-granted, so restoring access
means issuing a new buddy link and having the person redeem it again — if the
owner works out that is what happened.

## Work

- Make `approveTripPlaces` revive a revoked row rather than skip it: clear
  `revoked_at`, restamp `granted_at` and `granted_by`. That is what
  `approveContact` already does for `access_grants` after **B130**, so this is
  the same fix in the neighbouring table and should read the same way.
- Decide deliberately whether re-approval *should* restore a trip place, and
  write the answer down either way. There is a defensible argument that it
  should not — a journal guest and a trip companion are different things, and
  an owner who revoked somebody may not mean to hand back write access. If that
  is the decision, then **the approve response must say so**, and the owner
  needs a way to re-grant the place without a fresh invite. Silence plus
  `ok: true` is the one answer that is wrong.
- Whichever way: a test that revokes and re-approves, then asserts what the
  trip-scoped token can do — the assertion B98's suite does not currently make.

Check `lib/tripPeople.ts` for other selects filtered on `revoked_at is null`
that assume the column is never set.

## Acceptance

- Revoke then re-approve leaves the contact and their trip place in a state the
  approve response accurately describes.
- If the place is restored, their trip-scoped token writes again without a new
  invite. If it is not, the response says the place was not restored and names
  how to give it back.
- A test covers the round trip end to end.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.
