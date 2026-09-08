---
id: B834
title: Signup grants ten credits per verified email with no per-identity cap, so credits can be farmed with disposable inboxes
type: ISSUE
priority: medium
complexity: medium
area: credits, signup, abuse
found: "2026-09-07T16:01:36Z"
started: "2026-09-08T21:36:19Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T21:36:19Z"
---

# B834 — Signup grants ten credits per verified email with no per-identity cap, so credits can be farmed with disposable inboxes

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Bounded exposure (why this is low)

The ten credits cannot reach anyone. `day_mail`, `day_whatsapp`, `digest` and
`postcard` only ever go to a journal's own approved, opted-in contacts, and a
farmed journal has none — so there is no spam vector. The only spends a farmer
can actually consume are `helper` (one model write-up) and `transcription`
(audio→text), both self-serve, plus `storage` (their own disk). So the whole
prize is roughly CHF 2 of the operator's Anthropic/Deepgram budget per
verified email address. Worth a per-identity cap eventually; not a launch
blocker, and not an abuse path against other people.
