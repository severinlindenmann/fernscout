---
id: B241
title: An agent code can be issued for a trip that does not exist
type: ISSUE
priority: low
complexity: low
area: auth, api
found: "2026-09-04T08:24:28Z"
---

# B241 — An agent code can be issued for a trip that does not exist

## Why

`mayRequestAgentToken` (`app/api/auth/request/route.ts`) lets the journal's
owner through on the address alone, before the trip is looked at:

```ts
if (user.owner.email === address) return true;
if (!tripId) return false;
const trip = getTrip(tripRef(user.username, tripId));
```

So an owner who names a trip that does not exist — a typo, a trip they have not
created yet — is sent a code, and since B230 that trip is written onto the code
and the token minted from it is `write:trip:<typo>`. Every write with it
answers `404 unknown_trip`, which is the right refusal for the wrong reason:
nothing anywhere says the trip was never real.

Before B230 the same typo produced the journal-wide `write:content`, silently,
which was worse — this is the papercut left behind by closing that. Fail-closed
and unexplained, rather than fail-open.

A non-owner is unaffected: their branch already requires the trip to load and
to list them, and refuses with `403 not_authorised` when it does not.

## Work

- Resolve the named trip in `mayRequestAgentToken` for the owner too, and
  refuse a trip this journal does not have. `/api/auth/request` already answers
  `403 not_authorised` truthfully for the agent-code case, and the message
  there is a good model — say which id was not found.
- Watch what it discloses. That branch is reached by anybody who can type the
  owner's address, and "no such trip" for a guessed id is an existence oracle
  of the kind B232 is about. The owner's address is not a secret, so this
  probably wants the same uniform answer rather than a helpful one — decide,
  and write down which.
- `/api/auth/verify` needs no change: it already refuses an owner narrowing to
  a trip that does not exist, uniformly.

## Acceptance

- `POST /api/auth/request` with the owner's address and a trip id that is not
  in the journal does not issue a code.
- A test covering it, beside the B230 cases in `test/scope-escalation.test.ts`.
- All four checks pass.
