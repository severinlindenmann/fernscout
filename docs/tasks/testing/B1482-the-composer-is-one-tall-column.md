---
id: B1482
title: The composer is one tall column on desktop, with the settings shut behind a disclosure
type: FEATURE
priority: high
complexity: medium
area: photobook
found: "2026-09-11T15:56:56Z"
started: "2026-09-11T16:10:05Z"
merged: "2026-09-11T16:16:13Z"
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

At `lg` and above: the book left, the settings card open on the right.

**The spread grid is deliberately not built, and the reason is the layout
itself.** The strip is `body.bare[data-view="spreads"] .spreads` in
`lib/photobook/preview.ts` — a snap-scrolling flex row inside an iframe, whose
viewport is the element's own width. Once the settings take 20rem of a 1280px
screen the book has roughly 600px left, which is *narrower* than the strip has
today: a wrapping grid there would show two cramped spreads where the strip
shows one readable one. The grid would also strand `useSpreadKeys` — the arrow
keys step a snap strip and mean nothing in a grid — and that CSS is shared
with the reading view and the print preview.

So: one spread at a time, beside its settings. Below `lg`: exactly what ships today —
the carousel and the `<details>`, unchanged, because B548 is right about the
phone.

Tapping a spread still opens that day, and the keyboard arrows still move
through the book.

Not doing: the wizard. It is already in the draft's grammar — yellow progress
bars, choice cards, one question per step — and needs nothing.

## Acceptance

At 1280 the settings are visible without a click, beside the book; at 390 the
page is structurally what shipped before — book, then the closed disclosure. No console
error, no horizontal scroll at either width.