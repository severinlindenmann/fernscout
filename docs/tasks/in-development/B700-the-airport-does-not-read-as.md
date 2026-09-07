---
id: B700
title: The airport does not read as an airport, and has no bench of its own
type: ISSUE
priority: medium
complexity: low
area: travel scene, buildings, branding bench
found: "2026-09-07T10:45:43Z"
started: "2026-09-07T10:46:11Z"
session: dfdad8fc-a6fc-47f8-9531-e49449f80aae
claimed: "2026-09-07T10:46:11Z"
---

# B700 — The airport does not read as an airport, and has no bench of its own

## Why

B634 added the airport and it is on screen — a person holding the flight leg at
7% and looking straight at the departure skyline reported it as missing twice.
It is drawn: a 22px terminal that is the same rounded box, in the same palette,
with the same flat roof cap every `kind: "flat"` building already has, plus a
3px mast. Beside four other blocks at the bottom of a 340px frame it reads as
one more block with a stick on it, not as an airport.

There is also nowhere to look at it alone. `/docs/branding/animation` has a
Vehicles bench that takes each vehicle out of the scene and holds it still, and
the Skylines bench renders whole `<Cityscape>`s without ever passing `airport`
— so the only way to see the building is to set the mode to flight, hold a
moment near 0% or 100%, and find it among the towers. The one output no test
can check is the one with no bench.

## Work

- Draw it so the silhouette says airport: a longer, lower terminal with a roof
  that is not the flat cap every other building wears, and a control tower tall
  enough to clear the skyline rather than one that ends among it.
- Give the buildings a bench of their own — every `kind` drawn alone, side by
  side, the way Vehicles does it. That means lifting the building `<g>` out of
  the `buildings.map()` in `components/Cityscape.tsx` into something the bench
  can render one of; no new selection mechanism.
- Not doing: changing how buildings are chosen, or adding a second airport to
  the ground layer.

## Acceptance

- A Buildings section on `/docs/branding/animation` shows all five kinds alone,
  the airport among them.
- On the whole-scene bench at mode `flight`, moment ~5%, the airport is
  identifiable as one at the size the scene actually draws it.
