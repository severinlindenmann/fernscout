---
id: B269
title: The photobook has its own bounding-box code with the same NaN hole B265 closed for the web maps
type: ISSUE
priority: medium
complexity: low
area: photobook, maps
found: "2026-09-04T11:52:43Z"
related: B268
started: "2026-09-04T15:49:33Z"
session: 67c9cca1-5b74-49e7-b1a4-dbee6bf7ce21
claimed: "2026-09-04T15:49:33Z"
---

# B269 — The photobook has its own bounding-box code with the same NaN hole B265 closed for the web maps

## Why

Found while fixing B265, and out of scope there because it renders no web page.

`lib/photobook/plan.ts` (`routeView`) is a second, wholly independent
bounding-box implementation for the printed book, with the same
`Math.min`/`Math.max` shape and therefore the same hole: a stop whose `lat` is
not a finite number takes the whole frame to `NaN`. `lib/photobook/source.ts`
(`routeFor`) is the point-builder feeding it, and it reads from `getPlaces`
like everything else.

The failure mode is worse here than on the web, not better. A map that draws
nothing on a page is visibly wrong and free to fix; a photobook is generated,
paid for and posted. Nobody proofreads a blank map on page forty before it
goes to a printer.

Photobook is off on this instance (`/api/health` reports
`photobook: not enabled on this server`), which is why this is not urgent —
and also why it will not be noticed until somebody turns it on.

## Related

Both are the `NaN` hole B265 closed at `lib/mapFrame.ts`, surviving in a
copy that choke point does not reach — the slideshow's own projection (B268)
and the photobook's own bounding box (B269). Same shape, same guard, two
files; whoever takes one should take the other in the same change.

## Work

- Guard `routeView` against non-finite coordinates. `isPlottable` in
  `lib/mapFrame.ts` is the existing predicate and importing it is cheaper than
  a second copy.
- Then ask the question this capture really exists for: whether the photobook
  needs its own frame maths at all, or whether `frameRoute` can serve both and
  this file can lose a hundred lines. Read both before deciding — the print
  frame may have constraints (a fixed page aspect, bleed) the screen one does
  not, in which case say so in the file.

## Acceptance

A photobook generated from a trip where some days have no coordinates produces
a map of the located days, and no `NaN` reaches the PDF. A test on `routeView`
with a mixed point list.

## Resolution

`routeView` now filters `route` through `isPlottable` (imported from
`lib/mapFrame.ts`) before it does anything with it, and returns the
whole-world rectangle when nothing is left — same shape as `frameRoute`'s own
empty case.

That closes half the hole. The other half was not in `routeView` at all: the
`"route"` case in `materialise()` (`lib/photobook/plan.ts`) built its
`MappedPoint[]` — the per-stop dots and the connecting line
`lib/photobook/render.ts`'s `drawRoutePage` actually draws into the PDF —
straight from `source.route`, via `projectEquirectangular`, without going
through `routeView` at all. Fixing only the bounding box would have left a
`NaN` point drawn on an otherwise-correctly-framed map. That case now filters
`source.route` through `isPlottable` once and reuses the same filtered list
for both `routeView` and the point projection, with a comment at the call site
saying why the filtering can't live in `routeView` alone.

**Decision: the photobook keeps its own bounding-box code; it does not move to
`frameRoute`.** Read both, per the Work section, and there are two real
constraints `frameRoute` doesn't share:

- `frameRoute`'s frame is **latitude-corrected** (`lngScale = cos(latitude)`),
  which only means something once every coastline path and every projected
  point in the same drawing agree to apply it. The photobook's map
  (`mapProjector`, `drawRoutePage`'s window-culling, `MAP_SPACE`) all work in
  the **same, uncorrected** equirectangular space `lib/worldLand.json`'s
  coastlines are baked in. Introducing `lngScale` in `routeView` alone would
  shift the route's bounding box out of registration with the coastline
  window every other part of the print map still culls and draws uncorrected.
- The book's map is a **fixed 2:1 spread** (two trim widths across one trim
  height) — a physical-paper constraint `frameRoute`'s `TARGET_ASPECT` (1.6,
  chosen for a browser layout) has no reason to share, and the padding floor
  here is sized in the same uncorrected units for the same reason
  `KM_PER_UNIT` can't be borrowed without the correction that makes it
  meaningful.

Consolidating for real would mean teaching `mapProjector` and the renderer's
window-culling to work in a corrected space, or giving `frameRoute` a second,
uncorrected mode — both larger than the NaN hole this task exists to close.
The full reasoning is written as a doc comment directly above `routeView` in
`lib/photobook/plan.ts`.

`test/photobook.test.ts` adds: a mixed list dropped from `routeView` rather
than poisoning it (and matching the all-located result exactly), an
all-unlocated list framing the whole world, and a full `planBook()` run
whose rendered `"route"` page carries exactly the located stops with no `NaN`
in either the view or any point.
