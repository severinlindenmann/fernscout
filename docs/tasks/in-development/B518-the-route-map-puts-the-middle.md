---
id: B518
title: The route map puts the middle of the journey in the fold
type: ISSUE
priority: medium
complexity: medium
area: photobook, print
found: "2026-09-05T20:56:48Z"
started: "2026-09-05T21:52:32Z"
session: d9c396ea-a80a-4f80-954a-d37a0bf2c8c8
claimed: "2026-09-05T21:52:32Z"
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
