---
id: B1486
title: The spreads are a one-at-a-time strip where the drawing has a grid of the whole book
type: FEATURE
priority: high
complexity: medium
area: photobook
found: "2026-09-11T16:50:25Z"
started: "2026-09-11T17:12:42Z"
merged: "2026-09-11T17:17:30Z"
completed: "2026-09-11T19:13:39Z"
---

# B1486 — The spreads are a one-at-a-time strip where the drawing has a grid of the whole book

The approved drawing shows the whole book as a grid of spread thumbnails with
a mono caption under each — `14 Aug · Lagos`, `The route`, `Endpapers`. What
ships is one spread at a time in a horizontal snap strip, so a 46-page book is
twenty-three swipes and there is no way to see its shape.

## Why this was argued against once, and why that was wrong

B1482 recorded a reason not to build it: once the settings take 20rem the book
column is ~600px, narrower than the strip has today. That reasoning treated the
strip as the thing to protect. The drawing treats the *book* as the thing to
show, and a grid of small spreads at 600px says more about a book than one
large spread does.

## Work

`lib/photobook/preview.ts` already carries two layouts and picks between them
on a body attribute — `data-view="pages"` is a grid today
(`repeat(auto-fill,minmax(230px,1fr))`) and `data-view="spreads"` is the
column/strip. Add the composer case: a wrapping grid of *spreads*, each
captioned, inside the bare stylesheet.

The frame then needs a height rather than one spread's aspect ratio — a fixed
`70vh` with its own scroll at `lg`, the strip's aspect ratio below it.

Tapping a spread must still drill into that day (`extractSpreads` matches on
`figure[data-kind]`, which the grid keeps). The arrow keys step the strip; in
the grid they scroll it, or they go — say which in the code.

Not doing: the phone. Below `lg` the strip stays, which is what the drawing's
own phone frame shows.

## Acceptance

At 1280 the book reads as a grid of captioned spreads, six or so visible
without scrolling; tapping one still opens that day. At 390 the strip is
unchanged.