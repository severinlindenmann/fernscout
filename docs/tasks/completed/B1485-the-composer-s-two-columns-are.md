---
id: B1485
title: The composer's two columns are mirrored from the drawing they were built to
type: ISSUE
priority: medium
complexity: low
area: photobook
found: "2026-09-11T16:47:00Z"
started: "2026-09-11T16:47:13Z"
merged: "2026-09-11T16:57:26Z"
completed: "2026-09-11T19:13:39Z"
---

# B1485 — The composer's two columns are mirrored from the drawing they were built to

## Why

B1482 put the settings beside the book, which was the point — but on the other
side from the drawing it was built to. The approved draft has the settings card
on the left and the book on the right; what shipped is the book on the left and
the settings on the right.

Small, and worth doing anyway: the whole value of an approved drawing is that
the built thing matches it, and a mirror is the kind of difference nobody
writes down and everybody notices.

## Work

Swap the grid's two children in `BookLevelView.tsx` — the template becomes
`20rem minmax(0,1fr)` with the settings column first. At 390 the order is
unchanged: book, then the closed disclosure, which is what B548 wants and what
the draft's phone frame shows.

## Acceptance

At 1280 the settings card is on the left and the book on the right, matching
the drawing. At 390 the page is structurally what it is today.
