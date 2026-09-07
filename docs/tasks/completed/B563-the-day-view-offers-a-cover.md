---
id: B563
title: The day view offers a cover, map and costs drill-in that has nothing in it
type: ISSUE
priority: medium
complexity: low
area: photobook, composer
found: "2026-09-06T10:56:06Z"
merged: "2026-09-06T11:23:33Z"
completed: "2026-09-07T13:12:01Z"
---

# B563 — The day view offers a cover, map and costs drill-in that has nothing in it

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Tapping the front matter in the preview opens a drill-in headed *"Umschlag,
Karte & Kosten"* (`photobook.front.heading`). `DayLevelView.tsx` says what is
behind it, in its own comment:

> The front matter has no per-item settings of its own

So it is a door onto an empty room, and it sits next to a door that opens onto
real controls. Everything it appears to offer — the cover, whether the route map
is printed, whether the costs are — already lives in the whole-book settings,
which is the right place for it: those are decisions about the book, not about
one of its pages.

## Work

Remove it. Tapping front matter should do nothing, or should open the whole-book
settings where those choices actually are — decide which and say why.

Remove the strings it used if nothing else needs them, and the `"front"` arm of
`Drill` if it becomes dead. `npm run unused` (knip) is the check for that.

## Acceptance

- No drill-in leads to a panel with no settings in it.
- `npm run unused` is no worse than before.
