---
id: B705
title: The party hovers above the ground on a flight leg
type: ISSUE
priority: medium
complexity: low
area: travel scene
found: "2026-09-07T11:07:06Z"
started: "2026-09-07T11:07:33Z"
merged: "2026-09-07T11:14:57Z"
completed: "2026-09-07T13:14:09Z"
---

# B705 — The party hovers above the ground on a flight leg

## Why

`STAND_ON` in `components/TravelScene.tsx:62` puts the party 26px above the
frame's bottom on `sky`, the way it puts them 26px up on a path. On every other
surface those pixels are the ground band `Ground` draws — `GROUND_HEIGHT.sky` is
0, because a flight draws no ground. So on a flight leg the party stands on
nothing, 26px over the ridge and over the skyline they are supposedly standing
in, which is what a person looking at the scene reports as "the people are
hovering".

## Work

- Stand them on the line a flight leg actually has: the bottom of the frame,
  where `Hills` and both skylines are already sitting.
- Look at it at `/docs/branding/animation`, mode `flight`, held near 5%.

## Acceptance

- At mode `flight` the party's feet are on the same line as the skyline's
  ground strip, not above it.

## What shipped

`STAND_ON.sky` 26 → 4, and a comment saying why the other four values are not
the same kind of number: they are heights inside the band `Ground` draws, and
a flight draws no band, so 4 is the line `Hills` and both `Cityscape`s already
sit on. Looked at on `/docs/branding/animation`, mode `flight`, held at 3%.
