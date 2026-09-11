---
id: B1488
title: The buy panel has no object plate and no read-or-order pair where the drawing has both
type: FEATURE
priority: high
complexity: low
area: photobook
found: "2026-09-11T16:50:27Z"
started: "2026-09-11T17:30:26Z"
merged: "2026-09-11T17:38:52Z"
completed: "2026-09-11T19:13:40Z"
---

# B1488 — The buy panel has no object plate and no read-or-order pair where the drawing has both

Two things the drawing has and the buy panel does not: the cover plate beside
the price (it appears only when `options.cover` is set, which is the minority
of books), and the pair of buttons under the book — `Read the book` beside a
yellow `Order a printed copy`.

Today the read button sits alone under the spreads in outline navy, and the
order button is at the bottom of the panel in solid navy. The drawing makes the
ordering one yellow, which is this palette's colour for the thing that costs
money, and puts them together.

## Work

The plate: fall back to the book's *planned* cover when the owner has chosen
none — the preview knows which photograph is on the front, and that is the
picture the drawing shows.

The buttons: the pair under the book, ordering in yellow, and the order panel
below keeps the press it has.

## What shipped, and what did not

The **button pair** is done: `Read the whole book` beside a yellow
`Order this book` under the grid, and the press in the order panel now wears
the same yellow — on this palette that is the colour of the thing that costs
money, and it was navy while an outline button beside it had more visual
weight.

The **plate on every book** is not, and the reason is concrete rather than a
preference: `options.cover` only exists when the owner chose a cover, and the
planner's own pick lives in `BookPhoto.file`, a path relative to whichever
root holds the bytes and deliberately not a URL. Making it one is the preview
route's job and is captured as B1497. Until then the plate appears on a book
with a chosen cover and the size-and-binding block stands on the rest — the
fallback the layout was drawn to hold.

## Acceptance

Every book shows a plate, chosen cover or not. The two buttons sit together
under the book at 1280 and stack at 390.