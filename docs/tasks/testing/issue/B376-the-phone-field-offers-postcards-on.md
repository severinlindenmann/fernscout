---
id: B376
title: The phone field offers postcards on a server with postcards switched off
type: ISSUE
priority: low
complexity: low
area: contacts
found: "2026-09-04T21:23:37Z"
started: "2026-09-04T21:24:47Z"
merged: "2026-09-04T21:42:58Z"
---

# B376 — The phone field offers postcards on a server with postcards switched off

## Why

B360 hid the postal-address block on the invite and guestbook forms when the
`postcards` capability is off. The phone field's hint, rewritten by the
WhatsApp work that landed the same evening, now reads:

> for postcards, and for WhatsApp updates if you tick the box below

Observed 2026-09-04 on fernscout.ch at 0322e2a, where `/api/health` reports
`postcards: {"enabled": false}`. So the one surviving mention of postcards on
that form is on a server that has none, immediately below the block B360
removed for exactly that reason.

The hint used to be the model of honesty about this -- "kept on file for the
owner -- nothing on this site sends to it yet" was B303's fix.

## Work

Compose the hint from the capabilities actually on: name postcards only when
`postcards` is enabled, WhatsApp only when that is, and fall back to B303's
wording when neither is.

## Acceptance

With postcards off and WhatsApp on, the phone hint does not mention postcards.
With both off, it says the address is only kept on file.
