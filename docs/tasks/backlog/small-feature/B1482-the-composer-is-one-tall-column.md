---
id: B1482
title: The composer is one tall column on desktop, with the settings shut behind a disclosure
type: FEATURE
priority: high
complexity: medium
area: photobook
found: "2026-09-11T15:56:56Z"
---

# B1482 — The composer is one tall column on desktop, with the settings shut behind a disclosure

## Why

At 1280 the composer is one column roughly 760px wide and about 1850px tall:
cover carousel, page count, "read the whole book", the warnings card, a shut
`<details>` saying "Change how the book is made", then the order panel. Half
the screen is empty margin and the settings — the nine things the composer
exists to change — are behind a disclosure nobody opens.

The approved draft puts the settings in a card on the left and the spreads as
a grid on the right, so what the book *is* and what you can change about it
are visible at once. That is the difference between a composer and a preview
with a hidden form.

B548 put the settings behind one entry deliberately, and that reasoning holds
at 390 where the alternative is a wall of switches before the book. It does
not hold at 1280, where there is room for both.

## Work

At `lg` and above: settings card left, spreads right as a grid of thumbnails
rather than a one-at-a-time carousel. Below `lg`: exactly what ships today —
the carousel and the `<details>`, unchanged, because B548 is right about the
phone.

Tapping a spread still opens that day, and the keyboard arrows still move
through the book.

Not doing: the wizard. It is already in the draft's grammar — yellow progress
bars, choice cards, one question per step — and needs nothing.

## Acceptance

At 1280 the settings are visible without a click and the spreads read as a
grid; at 390 the page is byte-identical in structure to today. No console
error, no horizontal scroll at either width.