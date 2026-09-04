---
id: B350
title: A pre-approved guest is told there is nothing left to do, and lands on the journal signed out
type: ISSUE
priority: high
complexity: low
area: contacts
found: "2026-09-04T19:57:17Z"
started: "2026-09-04T20:17:22Z"
session: 62683d95-33a6-4db0-a254-7a8fcbcf014e
claimed: "2026-09-04T20:17:22Z"
---

# B350 — A pre-approved guest is told there is nothing left to do, and lands on the journal signed out

## Why

A guest invited with `{"kind":"guest","email":"…"}` is pre-approved: proving the
address is all that is left, and B333 correctly skips the owner's queue. The
page then says:

> **You're already in.** Nothing left to do — open The Lifecycle Journal and
> have a look.

They are not signed in. No session cookie is set by the confirmation, so
following that instruction lands them on a journal that shows only its public
trips and an access page reading "You are not signed in". The session actually
arrives in a *separate* mail ("You're in"), carrying a `/<user>/s/…` link the
success page never mentions.

Observed 2026-09-04 on fernscout.ch: `guest@severin.io` confirmed, was told
there was nothing left to do, and `/xydhd-lifecycle/me` reported them signed
out. `document.cookie` was empty.

For the person this reads as the invitation having silently failed — and the
mail they need is the one thing they were just told they no longer had to check.

## Why it matters more than the wording

They proved the address in this browser seconds earlier. The round trip through
a mailbox is buying nothing at that point, and B142's scanners spend the link
in the mail before they get to it.

## Work

Either sign them in at the moment they confirm — the address is proven, in this
browser, and the grant has just been written — or stop claiming there is
nothing left to do and send them to their inbox in the same sentence.

The first is the one worth building; the second is a one-line retreat if the
session cannot be minted there.

## Acceptance

Redeem a pre-approved guest invite and confirm the code. Either the journal
opens signed in, or the success page says the sign-in link is in their email.
Not both, and not neither.
