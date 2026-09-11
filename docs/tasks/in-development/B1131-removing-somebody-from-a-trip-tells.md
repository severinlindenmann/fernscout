---
id: B1131
title: Removing somebody from a trip tells the owner their token keeps working, and it does not
type: ISSUE
priority: medium
complexity: low
area: api, auth, contacts
found: "2026-09-09T17:59:56Z"
started: "2026-09-11T13:21:55Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T13:21:55Z"
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

Correct the `removed` branch of the note. It should say that the address can no
longer write to the trip and that any token it holds is refused from now on —
which is what `mayWriteTrip` actually does.

Check the same claim has not been copied elsewhere: `grep -rn "until it
expires" app lib`, and the buddy/contact revoke paths in `lib/contacts/`.

Not doing: changing any behaviour. The behaviour is right; only the sentence is
wrong.

## Acceptance

- Remove a person from a trip over the API and read the `note` — it does not
  tell the owner to revoke a token, and does not say one keeps working.
- A test asserting the note against the refusal, so the two cannot drift apart
  again.
