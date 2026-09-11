---
id: B1490
title: A proposal opens straight into the cropper with no card that says four cards are waiting
type: FEATURE
priority: high
complexity: low
area: postcards
found: "2026-09-11T16:50:28Z"
---

# B1490 — A proposal opens straight into the cropper with no card that says four cards are waiting

The drawing opens a proposal with a card: the front, `Four cards are waiting`,
what the agent wrote them from, `Waiting for you`, and one button — `Open the
cards`. The site drops the owner straight into the cropper with a slider under
their thumb.

The opening card is where the sentence that matters gets said: nothing has been
printed or charged, and nothing will be until you press send. Today that
sentence is a grey line under the title.

## Work

A first state for a pending order, before the stepper: the front, the head, the
status pill, and `Open the cards`. Pressing it reveals the steps; the choice is
not persisted — it is an opening, not a setting.

Not doing: anything for a settled order, which goes straight to the docket
(B1479).

## Acceptance

A pending order at 390 opens on the card, and one press reveals `Look`.