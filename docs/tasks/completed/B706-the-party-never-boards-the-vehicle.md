---
id: B706
title: The party never boards — the vehicle and the people are two animations that ignore each other
type: FEATURE
priority: medium
complexity: medium
area: travel scene
found: "2026-09-07T11:07:07Z"
started: "2026-09-07T11:07:34Z"
merged: "2026-09-07T11:14:58Z"
completed: "2026-09-07T13:14:09Z"
---

# B706 — The party never boards — the vehicle and the people are two animations that ignore each other

## Why

The vehicle crosses the frame and the party fades out where they stand; the
two never meet. Nobody boards anything — the people dissolve beside a road while
a bus goes past them, and at the far end a bus goes past a place where people
later appear. It reads as two animations sharing a frame rather than one
journey, and boarding is the whole gesture a travel journal's transition is
about.

## Work

- Give the leg a shape: the vehicle comes in and **stops beside the party**,
  the party goes (they are aboard), the vehicle pulls away with the pan, and at
  the arrival it stops again and the party steps off beside it.
- The camera pan (`travel`) already brackets the crossing — move its ends to
  match the two stops rather than adding a second clock.
- A flight is on the ground for both stops: `vehicleY` climbs after the
  departure stop and is back down before the arrival one.
- `walk` has no vehicle and is unchanged.
- Not doing: doors, stairs, a figure that walks to the vehicle.

## Acceptance

- On `/docs/branding/animation`, holding a `bus` leg through its moments
  shows: vehicle arrives and stops beside the party → party gone → both move →
  vehicle stops → party back beside it.
- Held at any moment, the party is never mid-air on a flight and never
  standing on open water.

## What shipped

Four named fractions at the top of `components/TravelScene.tsx` — `BOARD`,
`DEPART`, `ARRIVE`, `ALIGHT` — and every layer reads from them instead of from
its own hand-tuned numbers:

- `vehicleX` gained two dwells and a per-segment ease, so it brakes into the
  near stop, holds, pulls away, and settles into the far one.
- `peopleX` holds at 6% until BOARD and is at 64% by ARRIVE; the move between
  the two happens while they are inside the vehicle and invisible.
- `peopleOpacity` is one clock now (`p`), not two: in at the start, out over
  BOARD→DEPART, back over ARRIVE→ALIGHT, and it stays — an arrived leg is the
  party standing in the new place rather than an empty street.
- `travel` runs DEPART→ARRIVE, so the world moves when and only when they do.
- `vehicleY`/`vehicleRotate` put a flight on the ground for both stops and
  climbing only between them.

The vehicle is drawn after the party, so it covers them at the stop — which is
what makes them disappear *into* it rather than beside it.

Looked at on `/docs/branding/animation` as contact sheets of held moments for
`bus`, `flight`, `boat` and `walk` (unchanged — no vehicle to board).
