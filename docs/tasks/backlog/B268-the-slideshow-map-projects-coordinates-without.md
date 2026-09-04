---
id: B268
title: The slideshow map projects coordinates without mapFrame, so a coordinate-less day breaks it the same way
type: ISSUE
priority: medium
complexity: low
area: slideshow, maps
found: "2026-09-04T11:52:43Z"
---

# B268 — The slideshow map projects coordinates without mapFrame, so a coordinate-less day breaks it the same way

## Why

Found while fixing B265, and deliberately left alone there.

`components/SlideShow.tsx` has a `SlideMap` that projects `places` through
`project()` directly, bypassing `lib/mapFrame.ts` entirely — so the
`isPlottable` guard B265 added at that choke point does not reach it. A day
written without `lat`/`lng` therefore does to this map exactly what it did to
the other three: `NaN` into every attribute, and nothing drawn.

It was out of B265's scope for a real reason rather than tiredness. The
component is `dynamic(..., { ssr: false })` and only mounts behind a click, so
it never reaches served HTML — which is what B265's acceptance criterion
measured, and why the fix there was verifiably complete on its own terms. The
bug is still there for anybody who opens the slideshow.

## Work

- Use `isPlottable` from `lib/mapFrame.ts` before projecting, the same as the
  other three maps now do.
- Then look at whether `SlideMap` should be using `frameRoute` rather than its
  own projection at all. If it should, that is the real fix and the guard comes
  free; if there is a reason it cannot — a fixed frame, a different aspect —
  write the reason down where the next reader will find it, because a fourth
  map with its own projection is how this bug survived the first three being
  fixed.

## Acceptance

Opening the slideshow on a trip where some days have no coordinates draws the
located days and no console error. A test covering `SlideMap` with a mixed
point list.
