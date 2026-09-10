---
id: B1127
title: No entry point exists for a person to start the WhatsApp channel — no wa.me link, no linking code
type: FEATURE
priority: low
complexity: low
area: whatsapp
found: "2026-09-09T17:56:46Z"
started: "2026-09-09T20:27:38Z"
merged: "2026-09-09T22:06:54Z"
completed: "2026-09-10T15:12:29Z"
---

# B1127 — No entry point exists for a person to start the WhatsApp channel — no wa.me link, no linking code

## Why

B1057 and B1058 built the whole receiving side — a webhook route, signature
verification, per-sender rate limiting, and automatic binding of a proven
number to a journal (`lib/whatsapp/dispatch.ts`). None of it is reachable by
a person: there is no `wa.me` link anywhere on the site, so an owner whose
number is already proven (B1065) has no way to discover that messaging the
instance's own number does anything at all. B1058's own Work section named
this ("An entry point: a `wa.me` link on the landing page and in the room,
with a prefilled first message") and it was left out of that build as
discovery rather than correctness — see its "Built" section.

## Work

- A `wa.me/<number>?text=<prefilled>` link, placed somewhere an owner whose
  number is already proven would see it — the landing page and/or the room
  are both named in B1058's Work section; pick one and say why.
- Consider a one-time linking code so an owner already signed in on the web
  binds their number in one tap, rather than relying purely on the automatic
  E.164 match. Not required — automatic binding already works — but worth
  deciding rather than assuming.

## Acceptance

An owner with a proven number can find and follow a link that starts a
WhatsApp conversation with this instance's number, with a first message
already filled in.
