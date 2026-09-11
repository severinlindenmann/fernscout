---
id: B1247
title: A failed journal creation says unknown and empties every field the person filled in
type: ISSUE
priority: high
complexity: low
area: signup, helper
found: "2026-09-10T09:14:00Z"
started: "2026-09-11T08:26:06Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T08:26:06Z"
---

# B1247 — A failed journal creation says unknown and empties every field the person filled in

## Why

The last step of the `/agent` wizard is the one form this product has, and it
is a long one on a phone: title, address, full name, nickname, a language, an
optional second language, a currency and a visibility. When the create call
fails, two things happen and both are bad.

**It says `That did not work: unknown`.** That was the whole message shown while
the server was answering an `EACCES` (B1246). "unknown" is not a sentence a
person can act on — they cannot tell whether the address is taken, the server is
broken, or they typed something wrong, so the only move left is to try the same
thing again, which is what they will do.

**Every field is cleared.** After the failure the form came back blank: eight
answers, several of them ones the wizard has just explained cannot be changed
later, gone. On a phone that is a minute of retyping for a failure the person
did not cause — and it happens on *every* failure, including a mistyped address
that is already taken, where retyping the other seven fields is pure punishment.

Reproduced on fernscout.ch at 390px, twice, on 2026-09-10.

## Work

- Keep the answers. The failure branch should re-render the form with the state
  it had, so a retry is one edit and one tap.
- Say something true and specific. Map the failures the route can actually
  return (address taken, address refused, journal limit, server error) to a
  sentence in the person's own language; keep a genuine fallback for the rest,
  but make the fallback say that the server failed and the answers are kept,
  rather than printing an error code word.
- Not in scope: the layout of the form, which is B1249.

## Acceptance

- Submitting the wizard against a server that fails the create call leaves every
  field filled and shows a sentence naming what happened.
- Submitting an address that already exists names *that*, and does not clear the
  other seven fields.
