---
id: B230
title: A code issued for one trip is verified into a journal-wide token
type: SECURITY
priority: high
complexity: low
area: auth, api
found: "2026-09-04T07:59:18Z"
started: "2026-09-04T08:08:58Z"
merged: "2026-09-04T08:29:10Z"
session: 62683d95-33a6-4db0-a254-7a8fcbcf014e
claimed: "2026-09-05T07:33:16Z"
---

# B230 — A code issued for one trip is verified into a journal-wide token

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

## What was built

Branch `g16-token-scope-escalation`.

**The trip is bound to the code.** `login_codes` gains `trip_id`
(`lib/db/migrations/011-code-trip-binding.ts`), `issueCode` writes it —
`/api/auth/request` passes the trip it has just checked with
`mayRequestAgentToken` — and `verifyCode` reads it back off the row. There is
no longer a second value for a caller to disagree with.

**Two layers, both closed.**

- `verifyCode` (`lib/auth/index.ts`) enforces the binding itself: a bound code
  mints `write:trip:<trip_id>` and nothing else, whatever scope the caller
  passed. A caller asking for something wider is refused with the new
  `out-of-scope` reason, *before* the code is consumed, so a wrong body does
  not spend a code the person is still holding. This is the check no route can
  forget.
- `agentScope` in `app/api/auth/verify/route.ts` no longer reads the trip from
  the request body at all. It reads the code's binding (`pendingCodeTrip`) and
  decides: a bound code opens its own trip; an **unbound** code is refused
  unless the address is the journal's `owner.email`, so `undefined` — which
  still means "the whole journal" — is now returned from exactly one branch.
  Every value it does not recognise is a refusal, where each one used to widen.

**What is preserved.** The owner may still narrow at verify time by naming a
trip, which is what the function was written for; naming a trip that does not
exist is refused instead of widening. Publishing is untouched and remains
owner-only. `resolveSession`'s cookie/bearer wall and its `cache()` (B53) were
not touched.

**The refusal is the endpoint's uniform `401 invalid_code`**, with no message.
A friendlier body would say which of "your code is for another trip", "you do
not own this journal" and "no such trip" applied — each a question about
somebody else's journal answerable by a caller holding no code, and the first
would make an outstanding code enumerable. The operator gets a `console.warn`;
`/agent.md` and `openapi.json` now state the rule, so an agent does not need to
learn it from an error.

`tripWriteScope` moved to `lib/auth` (re-exported from `lib/tripPeople`, every
caller unchanged) so the minting side and the reading side build the string
from one definition.

## Evidence

`test/scope-escalation.test.ts` — the B230 cases are flipped and both halves of
the reproduction now go through the real routes (`/api/auth/request`, then
`/api/auth/verify`) rather than calling `issueCode` directly.

Before, against `main` at `11003ce`:

```
AssertionError: expected [ 'write:content' ] to deeply equal [ 'write:trip:alps-2026' ]
```

After: `scope: ["write:trip:alps-2026"]`, and that token gets `404
unknown_trip` on `honeymoon-2026` while still writing `201` into `alps-2026`.
Naming a trip they are not on answers `401 invalid_code` with no token, and the
code stays live. Reverting the fix in the worktree fails 11 of the file's 16
cases; with it, `npx vitest run` is 137 files / 2161 tests green, and
`test/write-revocation.test.ts` passed unchanged throughout.

Also captured while here: **B240** (every owner-only gate is a scope-string
check, which is what made one minting bug open all of them) and **B241** (the
owner can still be issued a code for a trip that does not exist — fail-closed
since this fix, but unexplained).

## When it ships

The migration adds a nullable column, so an existing database needs nothing but
`db:migrate`. One thing to know while testing: **every code outstanding at the
moment of the deploy has no trip on it.** For the journal's owner that is
unchanged — an unbound code is theirs and still opens the journal. For anybody
else it is now a refusal, so somebody who asked for a code just before the
deploy and reads it just after gets `401 invalid_code` and has to ask again.
Codes live thirty minutes; the window closes on its own.
