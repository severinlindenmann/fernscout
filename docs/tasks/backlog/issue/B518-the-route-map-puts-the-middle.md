---
id: B518
title: The route map puts the middle of the journey in the fold
type: ISSUE
priority: medium
complexity: medium
area: photobook, print
found: "2026-09-05T20:56:48Z"
---

# B518 — The route map puts the middle of the journey in the fold

## Why

Found the moment B514 made the preview show spreads, which is what that ticket
was for.

`routeView` frames the journey and `mapProjector` centres it across the two
pages, so the middle of the route lands on the fold. On a perfect-bound book
the fold is the one part of the paper a reader cannot flatten, and the gutter
is 16mm — wider than the outer margin, deliberately, because the pages curve
away there.

So the map is composed to put its most important part where it is hardest to
see. On `parks-2025` the line crosses the seam twice and one stop sits almost
on it.

Invisible in the old flat grid of single pages, obvious the first time the two
halves were drawn together. Nothing is wrong with the projection; the framing
just has no opinion about the fold.

## Work

Bias the frame so the route avoids the centre, or accept the centre and make
the fold cost less.

The cheap version: shift the window so the densest part of the route sits in
one half rather than across the join. `routeView` already computes the bounding
box, so it knows where the stops cluster.

The better version, and more work: treat the gutter as unusable and frame to
the two outer halves, the way an atlas does.

Whichever, a single-page map should stay possible — a trip whose route is a
short hop does not need a spread at all, and `draftsForFront` already decides
whether to emit one.

**Not doing:** moving the map off the spread entirely. Two pages is the right
amount of paper for a fortnight's driving, and the spread is the reason the
map reads at all.

## Acceptance

- On `parks-2025` no stop sits within the gutter, and the route crosses the
  fold at most once.
- A trip whose route is a straight line still gets a sensible frame.

## What the acceptance turned out to be

Measured every fold position across the frame, on all four real trips
(`getPlaces` from `@/lib/entries` loads them; `content/example/trips/` is
tracked, not gitignored). Zero stops in the gutter is reachable for every one
of them only by putting the fold outside the stops' range entirely — the
whole route on one page, the other blank. With both pages required to carry
at least a quarter of the stops, a fully clear band is *impossible* on
`parks-2025`, `alps-2024` and `asia-2023`: at 8% of the frame's width, there
is no gap that wide anywhere near the middle of those routes.

So the acceptance as written cannot be met by shifting, on the trips it names.
The honest goal, and what the second pass of this ticket built, is
*never-worse*: score a candidate centre by (stops in the band, then fold
crossings in travel order), lowest wins, and keep the frame's own untouched
midpoint unless a candidate strictly beats it. Measured against that:

```
parks-2025: BEFORE inBand=1 crossings=1 -> AFTER inBand=1 crossings=1  (no shift — none available was better)
alps-2024:  BEFORE inBand=4 crossings=2 -> AFTER inBand=0 crossings=0  (shifted -6.1%)
usa-2026:   BEFORE inBand=0 crossings=1 -> AFTER inBand=0 crossings=1  (no shift)
asia-2023:  BEFORE inBand=0 crossings=1 -> AFTER inBand=0 crossings=1  (no shift)
```

The first attempt at the cheap version shifted whenever any gap existed
between two stops, without checking the shift was actually better than
leaving the frame alone — on `parks-2025` that took a shift of a fifth of the
frame's width and still left a stop in the band, while doubling the
crossings. Scoring against the untouched midpoint and only moving on a
strict win is what fixed it. Do not re-attempt "always find some gap and
shift there" without that comparison; it looked like an improvement on the
synthetic fixtures and was a regression on real content.
