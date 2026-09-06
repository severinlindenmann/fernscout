---
id: B640
title: The vehicle icons on the map slideshow are upside down when travelling westward
type: ISSUE
priority: medium
complexity: low
area: map slideshow
found: "2026-09-06T17:51:56Z"
started: "2026-09-06T18:04:53Z"
session: e5f23c58-bb87-4175-ad7b-5d3aed93169f
claimed: "2026-09-06T18:04:53Z"
---

# B640 — The vehicle icons on the map slideshow are upside down when travelling westward

## Why

On `/<user>/map`'s slideshow, the vehicle icon for the leg being travelled is
rotated to point along the direction of travel —
`components/SlideShow.tsx:788`, `rotate(${angle})` from `Math.atan2`. For a
westward leg the angle is near 180°, so the whole glyph turns over and the car
and the plane arrive upside down.

Pointing along the path is right; turning the vehicle over is not. A car facing
left is a mirrored car, not an inverted one.

## Work

- Where the heading is leftward, mirror the glyph rather than rotating past
  vertical — flip horizontally and keep it upright.
- The trip map draws the same bowed legs (`SlideShow.tsx:716` says it copies
  it); check whether it has the same fault and fix both, since one guard covers
  both callers.
- Look at it: `check-a-drawing`, on a westward leg and an eastward one.

## Acceptance

- A leg travelling west shows the vehicle facing west and upright.
- An eastward leg is unchanged.

## Found

Only one call site does this rotation: `SlideMap` in `components/SlideShow.tsx`
(the "leg being flown right now" vehicle glyph, ~line 780). The comment at
line 716 that reads "exactly as the trip map draws it" is about the bowed
*path* the leg is drawn along, not the vehicle icon — the actual trip map
(`app/[user]/(trip)/map/MapPageContent.tsx`, the static per-trip map) draws no
vehicle icon and does no heading rotation at all, and `SlideMap` itself has
only one caller (the slideshow). So there was one fault, not two, and one
guard (`vehicleHeadingTransform`) covers it.

Fix: `vehicleHeadingTransform(headingDeg)` in `components/SlideShow.tsx` —
`rotate(angle)` for `|angle| <= 90`, `rotate(angle + 180) scale(-1, 1)`
beyond that (mirror horizontally, then rotate only the residual angle rather
than continuing to rotate the glyph past vertical). Covered by
`test/vehicle-heading-transform.test.ts` (forward direction always matches
the heading; the icon's local "up" vector never points screen-downward for
any heading in [-180, 180]). Looked at it directly: rendered `SlideMap`'s
vehicle glyph (car and plane) to static SVG for east/south/west/north
headings and screenshotted with chrome-devtools MCP — west now shows an
upright, mirrored car/plane rather than one flipped roof-down.
