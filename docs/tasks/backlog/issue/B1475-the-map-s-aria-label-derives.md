---
id: B1475
title: The map's aria-label derives its own tense and never learns the trip is over
type: ISSUE
priority: low
complexity: low
area: map, a11y
found: "2026-09-11T15:36:41Z"
---

# B1475 — The map's aria-label derives its own tense and never learns the trip is over

## Why

Found while building B1289 and deliberately left alone rather than absorbed.

B1289 fixed the map page's heading and empty-state copy: the tense now asks
`isOver(trip, days)` as well as whether any day carries coordinates, so a
finished trip stops saying *"Where we're going"*.

`components/WorldMap.tsx` builds **its own** aria-label tense, independently,
from `places.length` alone. It is never passed `over` and has no way to know.
So the visible heading and the label a screen reader hears can now disagree —
the page says the trip is finished and the map says it is planned.

The window is narrow: it needs a finished trip with a planned route or a track
but no coordinate places. That is why it is low and why B1289 did not widen its
own scope to swallow it. It is still exactly the kind of gap AGENTS.md names —
a fact derived in two places, which will disagree within a month — and this one
disagrees only for somebody who cannot see the heading that contradicts it.

## Work

Pass the tense down rather than re-deriving it, so the label and the heading
come from one decision. B1289 already computes it on the page.

Check whether anything else on that page derives tense for itself while there.

## Acceptance

- On a finished trip with a route but no coordinate places, the map's aria-label
  and the page heading agree.
- Nothing on the map page computes the tense twice.
- `npm run verify` clean.
