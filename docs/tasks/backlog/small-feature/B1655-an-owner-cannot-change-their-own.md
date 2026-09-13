---
id: B1655
title: An owner cannot change their own email or phone number
type: FEATURE
priority: low
complexity: medium
area: Journals
found: "2026-09-13T09:55:10Z"
---

# B1655 — An owner cannot change their own email or phone number

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

An owner has two contact details — an email address and a phone number — and
today can change **neither** from any surface they can reach.

- `owner.email` is set when the journal is created and never again. It is also
  the ownership anchor: `lib/contacts/session.ts` reads it on every request to
  decide who the owner is, and a journal with none "has no owner, and
  therefore no admin surface".
- `owner.tel` is set at signup (SMS or WhatsApp proof) or by an agent holding
  an owner-scoped token through `PATCH /api/v1/{user}/config`. There is no
  browser path; B1653 has just made `/me` say so rather than pretending
  otherwise.

Parked deliberately by the owner on 2026-09-13 — *"up to today there is no
feature for the user to change it, this will maybe be a feature for the future
but not right now"*. This ticket exists so that decision is a record rather
than a gap somebody rediscovers.

## Work

Not scheduled. When it is, the hard part is not the form:

**Changing an email address is changing who owns the journal.** It cannot be a
field that saves — the new address has to be proved before it takes effect, or
a stolen session becomes a stolen journal. The existing identity-code flow is
the shape to reuse: prove the new address, then swap. Consider whether the old
address should be told, since that is how somebody notices a takeover.

**Changing a phone number re-opens the provenance question** in B1654: a number
proved by passcode is a stronger claim than one typed in, and whatever stores
it should say which it was.

## Acceptance

An owner can change either detail from a surface they can reach, and neither
takes effect until the new value is proved.
