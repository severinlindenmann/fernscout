---
id: B78
title: How a leg was travelled is carried by colour alone, and its dash pattern breaks on a small map
type: ISSUE
priority: medium
complexity: low
area: map, transport
found: "2026-09-01"
started: "2026-09-01"
---

# B78 — How a leg was travelled is carried by colour alone, and its dash pattern breaks on a small map

## Why

`TRANSPORT_STYLE` (`lib/transport.ts`) gives each mode a colour, and three of
the seven a dash. Everything else about a leg is identical: same width, same
bow, same cap. So on `asia-2023` the train to Bangkok, the motorbike down to
Huế and the boat across to Luang Prabang are one shape in three colours, and
the reader has to go to the legend to learn which is which.

Two specific problems.

**Colour alone is doing the work.** Four of the seven modes — train, bus,
motorbike, car — have no dash at all, so they differ only in hue. That is the
one distinction some readers cannot make, and the legend underneath does not
help somebody looking at the line.

**The dashes are in viewBox units, which B46 made wrong.** `flight: "10 7"`,
`boat: "6 5"`, `walk: "2 6"` are lengths in the map's coordinate space. That
was survivable when every frame was ~140 units wide; a frame over the Alps is
4.6 units, so a 10-unit dash is twice the width of the map and the line renders
as a single solid stroke or vanishes. This is the same class as the marker
radii and label sizes already fixed in B46 — the last place it survived,
because `lib/transport.ts` is a data file and did not look like a drawing
constant.

**And the shapes say nothing.** Every leg is bowed by the same
`Math.min(px(120), len * 0.18)` regardless of mode, so a flight and a walk
arc identically. A flight is the one leg that genuinely does not follow the
ground and could look like it.

## Work

Give `TRANSPORT_STYLE` two more fields and let the drawing read them:

- `dash` as a **pair of numbers in screen pixels**, not a string in viewBox
  units, so `WorldMap` can put it through `px()` like every other length.
  Undefined stays "solid".
- `bow`, a fraction of the leg's length. Flight most; boat some; train barely;
  road modes and walking essentially straight.

The intent, in one line each: a flight arcs and is long-dashed because it does
not touch the ground; a boat curves gently and is dotted; a train is nearly
straight and solid, because a railway is fixed; road modes are straight with
dashes that shorten as the vehicle gets smaller; walking is straight and finely
dotted.

Three consumers to keep in step: the legs in `components/WorldMap.tsx`, its
legend directly below them, and `components/SlideShow.tsx`, which draws the
same modes on its own map.

**Not doing:** icons on the line, per-leg labels, or a new mode. This is how
the seven existing modes are drawn, nothing more.

## Acceptance

- Each mode is distinguishable from every other without reference to colour —
  asserted on the rendered markup, not by eye.
- A dash pattern renders correctly on a frame a few units wide: a fixture trip
  inside ~10 km draws a dashed leg with more than one dash in it.
- A flight is visibly more curved than a walk over the same two points.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` and `npm run build` pass.
