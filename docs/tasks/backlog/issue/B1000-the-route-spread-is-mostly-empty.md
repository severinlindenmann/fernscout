---
id: B1000
title: The route spread is mostly empty for a compact trip
type: ISSUE
priority: medium
complexity: medium
area: photobook, route map
found: "2026-09-08T17:15:27Z"
---

# B1000 — The route spread is mostly empty for a compact trip

## Why

Four days round the Alps prints a two-page route spread that is almost
entirely empty grid. Two of twenty-eight pages, and it reads as broken.

Two faults were found and fixed (see `routeView` in `lib/photobook/plan.ts`):

- The padding floor was 6 map units — about 2.2 degrees of longitude *per
  side*. The Alps trip spans 0.6 degrees, so the frame was twelve times the
  route's own width and the journey printed as a thumbnail squiggle. The floor
  is now 1.2, and the route fills about half the spread's height instead of a
  sixth.
- `centreAwayFromFold` could slide the frame until a stop reached its *edge*,
  so for a route far narrower than its frame the winning candidate put the
  fold beyond the last stop and the whole journey landed on one page with a
  blank sheet facing it. The fold now stays inside the journey.

**What is left is geometry, and it needs a decision rather than a patch.**

A spread is 2:1. A compact, north-south journey — passes in the Alps, a week
in one valley — cannot fill it: forcing the frame to 2:1 means expanding it
sideways, so the route occupies about an eighth of the spread's width however
it is placed. And `lib/worldLand.json` has no coastline at that zoom, so the
surrounding space is bare graticule rather than land.

There is also a residual cost to the fix above: with the fold now inside the
journey, a stop can land in the gutter and lose its label. On the Alps trip
Andermatt does exactly that. The band (8% of the frame) is wider than the
largest gap between stops, so no fold position inside this route is clean.

## Work

A decision, then the work that follows from it. Options, roughly in order of
how much they cost:

- **One page instead of two for a compact route.** A 1:1 page suits a
  north-south journey far better than a 2:1 spread, and the map would fill it.
  The page planner already varies what it emits; this is a threshold on
  `routeView`'s aspect.
- **Draw land at close zoom.** The emptiness is really missing content. A
  coarser world file is not the answer; a terrain or place-name layer is, and
  it is a real dependency decision.
- **Drop the route spread for short trips**, the way the costs page is only
  printed when there is a budget.

Whichever is chosen, fix the label that a gutter stop loses — either place it
to one side or suppress the dot rather than bisecting it.

## Acceptance

- A four-stop, sub-degree trip prints a route the reader can read, with every
  stop named, and no page of bare grid.
- Somebody looks at it. A drawing is the one output no test can check — see
  the `check-a-drawing` skill.
