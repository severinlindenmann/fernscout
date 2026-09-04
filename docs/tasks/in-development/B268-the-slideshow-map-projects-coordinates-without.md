---
id: B268
title: The slideshow map projects coordinates without mapFrame, so a coordinate-less day breaks it the same way
type: ISSUE
priority: medium
complexity: low
area: slideshow, maps
found: "2026-09-04T11:52:43Z"
related: B269
started: "2026-09-04T15:49:33Z"
session: 67c9cca1-5b74-49e7-b1a4-dbee6bf7ce21
claimed: "2026-09-04T15:49:33Z"
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

## Related

Both are the `NaN` hole B265 closed at `lib/mapFrame.ts`, surviving in a
copy that choke point does not reach — the slideshow's own projection (B268)
and the photobook's own bounding box (B269). Same shape, same guard, two
files; whoever takes one should take the other in the same change.

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

## Resolution

Added the `isPlottable` guard: `pts` is now `(readonly [number, number] |
null)[]`, `null` for a place without finite coordinates, and every consumer
(route legs, markers, the travelling vehicle) skips a `null` rather than
drawing `NaN`. The camera (`cameraTarget`) holds the last located stop when
the active place has no coordinates, rather than jumping to `(NaN, NaN)` or
snapping straight to the world's centre — falling back further only if
nothing behind it is located either.

**Decision: `SlideMap` keeps its own `project()` call, does not move to
`frameRoute`.** Read both before deciding, per the Work section. The two are
different coordinate spaces on purpose:

- `SlideMap`'s viewBox is the **whole, uncorrected** world (`MAP_VIEWBOX`,
  1000×500) — the same space `useWorldLand`'s baked coastline paths are
  authored in. It never crops to a bounding box; the camera pans and zooms
  across the fixed whole-world viewBox with a `motion.g` transform instead.
- `frameRoute`'s `Frame` is a **cropped, latitude-corrected** (`lngScale`)
  space built for a static viewBox sized to the route. Projecting through
  `place()` would scale x by `cos(latitude)`, which would misalign every
  marker and the vehicle icon against the (uncorrected) coastline paths drawn
  alongside them — exactly the kind of drift `lib/mapFrame.ts`'s own doc
  comment warns `place()` exists to prevent, just in the other direction.

So a fourth map with its own projection is not an oversight here — the
`isPlottable` guard was the actual gap, and it is now imported from
`lib/mapFrame.ts` rather than reimplemented. This reasoning is also written
into a doc comment directly above `SlideMap` in `components/SlideShow.tsx`,
so the next reader does not have to reconstruct it from this file.

`test/slide-map.test.tsx` covers a mixed list (some located, some not) with
the active index on a located stop, on the unlocated one, and with the
unlocated stop between two located ones, plus a route with nothing located at
all — none put `NaN` into the rendered SVG.
