---
id: B230
title: A code issued for one trip is verified into a journal-wide token
type: SECURITY
priority: high
complexity: low
area: auth, api
found: "2026-09-04T07:59:18Z"
---

# B230 — A code issued for one trip is verified into a journal-wide token

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`/api/auth/request` is the check everything downstream leans on: it refuses an
agent code to an address that is neither the journal's `owner.email` nor listed
on — or a redeemed buddy of — the trip it named
(`app/api/auth/request/route.ts:230`, `mayRequestAgentToken`). That check is
correct.

**The trip is not bound to the code.** The code row is keyed on
`(owner, email, kind)` only (`lib/auth/index.ts`, `issueCode`), and the trip is
sent *again* at redemption. `agentScope` in
`app/api/auth/verify/route.ts:100-116` then decides the width:

```ts
async function agentScope(username, tripId, email) {
  if (!tripId) return undefined;                 // ← the whole journal
  const trip = getTrip(tripRef(username, tripId));
  if (!trip) return undefined;                   // ← the whole journal
  ...
  return isOwnerAddress || (await isPersonOn(trip, email))
    ? tripWriteScope(trip.id)
    : undefined;                                 // ← the whole journal
}
```

`undefined` means "no narrowing", and `openSession` turns it into
`SESSION_SCOPE.agent` — the owner's unqualified `write:content`
(`lib/auth/index.ts`, `openSession`). So **every value `agentScope` does not
recognise widens the token instead of refusing it**, including no value at all.

The attacker is somebody the owner deliberately let onto one trip: a name in
`people:`, or a buddy link the owner approved (B33). They ask for a code naming
their own trip — allowed — and then omit `"trip"` from the verify body.

What `write:content` reaches: `mayWriteTrip` returns `allowed` for it on every
trip in the journal without a query (`lib/api/auth.ts`, `tripWriteVerdict`), and
every "owner only" gate in REST and MCP is written as
`session.scope !== SESSION_SCOPE.agent` rather than as an identity check —
`PATCH /api/v1/<user>/config` (`app/api/v1/[user]/config/route.ts:93`),
`POST .../trips` (create), `DELETE /api/v1/<user>` and `.../trips/<trip>`,
`publish`, `create_trip`, `set_journal_features`, `publish_day`. So one trip's
buddy gains: read and write every trip in the journal including `private` ones
they were never on, read every unpublished draft, publish, create trips, change
the journal's `features`, and set the journal's own deletion in motion.

It does **not** reach the contacts admin surface or the invite endpoints —
those use `isOwner()`, which compares the session's address against
`owner.email` (`lib/contacts/session.ts:32`). That is the bound on the blast
radius, and it is also the shape of the fix.

Found by the B22 sweep; see `docs/security/2026-09-04-sweep.md`.

## Work

- Decide where the trip is bound. The straightforward answer is to **bind it to
  the code**: record the requested trip on the `login_codes` row at
  `issueCode`, and have `verifyCode` derive the scope from the row rather than
  from a field the caller re-sends. Then there is no second value to disagree.
- Failing that, `agentScope` must **fail closed**: an address that is not the
  owner gets `tripWriteScope` or a refusal, never `undefined`. `undefined`
  should be reachable only for the owner address.
- Either way, refuse rather than widen: a caller that names a trip it is not on
  should get a 401/403, not a broader token than it asked for.
- Consider making the owner-only gates ask `isOwner()` rather than
  `scope !== SESSION_SCOPE.agent`, so a single scope bug cannot re-open all of
  them at once. That is defence in depth, not the fix — capture it separately
  if it grows.

Not doing: changing `/api/auth/request`'s check, which is correct, or the
`write:content` scope string itself.

## Acceptance

- `test/scope-escalation.test.ts` — the three `B230` cases flip: verifying a
  trip-person's code with no `trip` field returns `["write:trip:alps-2026"]` or
  a refusal, never `["write:content"]`, and the resulting token gets `404
  unknown_trip` on a trip its holder was never on.
- `test/write-revocation.test.ts` still passes unchanged.
- All four checks pass.
