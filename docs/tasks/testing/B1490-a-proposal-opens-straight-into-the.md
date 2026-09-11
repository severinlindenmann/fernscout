---
id: B1490
title: A proposal opens straight into the cropper with no card that says four cards are waiting
type: FEATURE
priority: high
complexity: low
area: postcards
found: "2026-09-11T16:50:28Z"
started: "2026-09-11T17:57:50Z"
merged: "2026-09-11T18:02:42Z"
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

## What the first attempt got wrong

The card printed the head a second time: the page's title and intro, then the
card's own eyebrow, title and the same intro. That is the third time in this
programme a component grew a head while the page kept its own — B1479 and
B1480 were the other two — and the reason is always the same: a server-rendered
head above a client-rendered one, neither able to see the other.

Fixed by giving the head one owner. A pending order's head is the stepper's,
because only the stepper knows whether the opening card is showing and which
of the two titles applies; a settled order's is the docket's. The page renders
neither.

## Acceptance

A pending order at 390 opens on the card, and one press reveals `Look`.