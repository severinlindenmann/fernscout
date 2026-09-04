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
