---
id: B700
title: The airport does not read as an airport, and has no bench of its own
type: ISSUE
priority: medium
complexity: low
area: travel scene, buildings, branding bench
found: "2026-09-07T10:45:43Z"
started: "2026-09-07T10:46:11Z"
merged: "2026-09-07T10:59:18Z"
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

## What shipped

Three things were hiding it, and the drawing was only one of them.

- **The drawing.** The terminal was the same rounded box with the same flat
  roof cap every `kind: "flat"` building already wears, plus a 3px mast that
  ended among the roofline. It now has a curved roof over its whole length, a
  glazed front in one strip instead of the window grid, and a tower planted on
  the ground beside it that clears the skyline, with a cab that flares out over
  the mast and an aerial above that.
- **The trees.** `Tree` plants the verge at `width - 26` and `width - 6`, which
  is exactly where the terminal stands, because the terminal is the one
  building drawn at the skyline's edge. On a flight leg they move to the left
  verge.
- **The frame.** The terminal's `x` was wherever the building loop happened to
  stop, which can be past `loopWidth`; on the arrival side the skyline is
  anchored `right-2`, so the tower ran off the frame, which is
  `overflow-hidden`. Clamped to `width - airportW - 4`.

The building `<g>` came out of `buildings.map()` into an exported
`BuildingShape`, which is what the new **Buildings** bench renders — all five
kinds alone, with width and height sliders. Windows now light from a `seed`
fixed when the building is generated rather than from a generator consumed
during render, so the shape is pure and the bench can draw one without a
skyline around it. Every existing skyline's window pattern shifts as a result;
nothing asserts on it.

Looked at on `/docs/branding/animation` (headless Chromium against a dev
server on 3412, since both MCP browsers were held by other sessions):
the Buildings bench, and the whole scene on `flight` held at 5% and at 97% —
departure and arrival ends, which is where the two skylines actually are. The
default moment of 35% shows neither skyline, which is why this was reported
as "not drawn" in the first place.
