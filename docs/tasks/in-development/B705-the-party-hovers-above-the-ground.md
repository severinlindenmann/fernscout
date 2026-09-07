---
id: B705
title: The party hovers above the ground on a flight leg
type: ISSUE
priority: medium
complexity: low
area: travel scene
found: "2026-09-07T11:07:06Z"
started: "2026-09-07T11:07:33Z"
session: dfdad8fc-a6fc-47f8-9531-e49449f80aae
claimed: "2026-09-07T11:07:33Z"
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
