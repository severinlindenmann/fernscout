---
id: B637
title: The Fernscout mark on the car sits too far off centre
type: ISSUE
priority: low
complexity: low
area: branding, travel scene
found: "2026-09-06T17:51:55Z"
started: "2026-09-06T18:18:40Z"
merged: "2026-09-06T18:27:22Z"
---

# B637 — The Fernscout mark on the car sits too far off centre

## Why

The Fernscout mark on the car in the travel scene sits too far towards one end
of the body. On a small vehicle at small sizes it reads as an accident rather
than as branding. `components/travel/Vehicle.tsx:161` is where the wordmark is
placed.

## Work

- Move the mark towards the centre of the car's body.
- Check it on `/docs/branding/animation` at the sizes the scene actually uses,
  including the slider held mid-leg — `check-a-drawing` is the procedure, and
  its note about `originX` being a fraction of the bounding box is the trap
  waiting here.

## Acceptance

- The mark is visually centred on the car at every size the animation bench
  shows.

## Resolution

The car body (`Car` in `components/travel/Vehicle.tsx`) spans x=5 to x=101 in
its viewBox, and the wheels sit at cx=26 and cx=80 — both give a body centre
of x=53. The `Titles` call for the non-taxi livery was `x={13}`; measured with
`getBBox()` in a real browser, the rendered "Fernscout" text at that x is 27.4
units wide, so its centre sat at x≈26.7 — off toward the tail by about a
quarter of the body length, not toward the centre at all.

Changed `x={13}` to `x={39}` (`components/travel/Vehicle.tsx:453`), which
puts the measured text centre at x≈52.7 — on the body centre. Verified with a
real Chromium render (`getBBox()`, not arithmetic) before and after, at the
bench's `DRAWN WIDTH` slider extremes (60px and 340px) and in the "Whole
scene" panel with mode `car` held at moment 50%, which is the actual small
size the story uses. The taxi livery does not use `Titles` (it has its own
roof-sign/chequer look) and is unaffected.
