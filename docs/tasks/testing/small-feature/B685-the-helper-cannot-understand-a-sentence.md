---
id: B685
title: The helper cannot understand a sentence a person types at it
type: FEATURE
priority: medium
complexity: medium
area: agent
found: "2026-09-07T09:52:59Z"
started: "2026-09-07T11:46:59Z"
merged: "2026-09-07T12:16:15Z"
---

# B685 — The helper cannot understand a sentence a person types at it

## Why

Plan §3. The wizard covers the day; everything else the platform does — a new
trip, an invite, a photobook — would otherwise need a button apiece on a phone
screen. One box that takes a sentence and opens the right screen with the
fields filled in is what makes this feel like an agent rather than a form.

The discipline that keeps it safe: **the model routes, it never executes.**

## Work

- `lib/helper/intents.ts` — a registry, one row per thing the helper can do:
  the intent name, its slots, and what runs. The list shown to the model is
  generated from the registry, so it cannot drift from what exists.
- `POST /api/helper/route` — free and rate-limited (`lib/rateLimit.ts`),
  returning `{intent, slots, confidence}`. The model gets no client and no
  tools.
- Read-only intents answer immediately. **Every write is confirmed with its
  fields visible, however confident the router was.** Publish, postcards and
  deletion keep their own existing gates.
- One intent per turn. `unknown` lands on the buttons, not an apology.
- With the capability off the box is absent and the buttons are the whole
  interface.

Not doing: a model-planned multi-step sequence. The wizard is already the
multi-step machine.

## Acceptance

"make a new trip to Japan in March" opens the create-trip screen with title and
dates filled in and nothing written until the owner presses; "how much storage
do I have" answers without a confirmation; nonsense lands on the menu. The
intent list in the prompt is asserted to come from the registry.
