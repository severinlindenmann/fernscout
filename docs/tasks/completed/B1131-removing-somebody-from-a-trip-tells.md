---
id: B1131
title: Removing somebody from a trip tells the owner their token keeps working, and it does not
type: ISSUE
priority: medium
complexity: low
area: api, auth, contacts
found: "2026-09-09T17:59:56Z"
started: "2026-09-11T13:21:55Z"
merged: "2026-09-11T13:48:22Z"
completed: "2026-09-11T19:13:14Z"
---

# B1131 — Removing somebody from a trip tells the owner their token keeps working, and it does not

Found during B103, driven against fernscout.ch on 2026-09-09.

## Why

`PATCH /api/v1/{user}/trips/{trip}/people` answers a removal with, verbatim
(`app/api/v1/[user]/trips/[trip]/people/route.ts:95-98`):

> buddy-b103@severin.io is no longer on the trip and no longer in the byline —
> but a trip-scoped token already issued to that address keeps working until it
> expires. Revoke it if that matters.

That was true when it was written and B98 made it false. Driven on the live
instance in this order:

1. `PATCH .../trips/trip-one/people` with `{"people":[]}` → `200`, the note
   above.
2. The removed person's existing trip-scoped token, one second later, `POST
   .../trips/trip-one/days` → **`403 access_revoked`**, *"Your access to this
   trip has been withdrawn by the journal's owner, so this token can no longer
   write to it."*

So membership is re-checked at write, exactly as B98 asked, and the response
tells the owner it is not.

This is worse than an ordinary stale comment because of who reads it and when.
The owner has just removed somebody, is being told in the same breath that a
live write credential is still out there, and is told to go and revoke it —
work that is unnecessary, and worry that is unfounded, at the one moment they
are already anxious. It is also the shape AGENTS.md names as the thing the
helper's guards exist to stop: a sentence about what the system did that the
system knows to be untrue.

## Work

Done. `app/api/v1/[user]/trips/[trip]/people/route.ts:96-98` no longer tells
the owner a token "keeps working until it expires" or to "revoke it if that
matters". It now says: the removed address is no longer on the trip and no
longer in the byline, and any trip-scoped token already issued to it can no
longer write — re-checked on every request, so there is nothing left to
revoke.

`grep -rn "until it expires" app lib` found exactly the one occurrence; the
buddy/contact revoke paths in `lib/contacts/` carry no version of this claim
(checked `lib/contacts/index.ts` and `lib/contacts/inviteMailNote.ts`, neither
says a revoked credential keeps working).

`test/trip-party-api.test.ts` had the old, false claim baked into its own
assertion (`/keeps working until it expires/`) — updated to assert the true
sentence and to refuse the old phrase and "Revoke it if that matters"
outright. Added a second test that removes a person, then calls
`tripWriteVerdict` with their scope and address against the trip as it now
stands and asserts `"revoked"` — so the note's claim is checked against
`mayWriteTrip`'s actual verdict, not merely against phrasing.

No behaviour changed; only the sentence.

## Acceptance

- Remove a person from a trip over the API and read the `note` — it does not
  tell the owner to revoke a token, and does not say one keeps working.
- A test asserting the note against the refusal, so the two cannot drift apart
  again.
