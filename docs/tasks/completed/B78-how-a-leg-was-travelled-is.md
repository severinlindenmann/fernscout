---
id: B78
title: How a leg was travelled is carried by colour alone, and its dash pattern breaks on a small map
type: ISSUE
priority: medium
complexity: low
area: map, transport
found: "2026-09-01"
started: "2026-09-01"
merged: "2026-09-01"
completed: "2026-09-03"
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

### The dashes had never reached the screen at all

The Why above blames B46 for the dash lengths, and that was true but not the
whole of it. The dashes were also being **overwritten every time**, and had
been since long before B46.

`components/WorldMap.tsx` drew each leg as a `motion.path` animating
`pathLength` from 0 to 1 — the draw-itself-on effect. Motion implements
`pathLength` by taking over `stroke-dasharray`: it normalises the path and
writes `1 1` into that attribute. Inspecting the running page showed every leg
carrying `stroke-dasharray="1 1"`, including the train, which has no dash at
all in `TRANSPORT_STYLE` and is meant to be solid.

So the three modes that did have a dash never showed one, and the flight's
`"10 7"` was decorative in the source and nothing on the page. The unit bug and
this one had been hiding each other.

The legs now fade in rather than drawing themselves on. The dash carries which
way the leg was travelled; the draw-on was decoration, and information wins.
`components/SlideShow.tsx` keeps its `pathLength` animation, because there it
only runs on the leg currently being travelled and *is* the meaning — the rest
of its legs pass `initial={false}` and keep their dashes.

### A flight bowed the wrong way, and there was nothing to notice it on

The author asked for the Zurich flight to be added to the demo so the styling
could be seen working. It could — and drawing it immediately showed that the
arc swept **south over Africa**.

The bow was a plain perpendicular to the leg, so which side it fell on depended
on which way the leg happened to run. Every existing demo leg is short and
roughly north–south, where the difference is invisible; the first long
east–west leg made it obvious, and wrong in a way anyone who has taken that
flight would notice. Legs now bend toward the nearer pole, which is the
direction a great circle actually goes: Zurich–Bangkok arcs over the Caucasus
and past K2, not over the Sahara.

Three tests cover it, because the bug is a sign error and sign errors come back:
the arc is north of the route in the northern hemisphere, south of it in the
southern, and — the one that matters — the *same* side whichever end the leg
starts from. An eastbound and a westbound flight bowing opposite ways is
exactly what the old code did.

**The demo content it was found with is committed**:
`content/example/trips/asia-2023/entries/2023-01-08-leaving-zurich.md`, plus
three `transportMode` lines on the Bangkok morning that follows it. The trip
already declared `start: 2023-01-08`, a day before its first entry, so the
departure day fits the metadata exactly.

It carries **`test: true`**, per AGENTS.md — it is a day nobody lived, written
to prove the pipeline works. That is not cosmetic: the day page shows a banner
saying so, and the entry stays out of the feed and the search index. It still
draws on the map, which is the point. Removing that one line would make it read
as ordinary demo content, and that is the author's call rather than an agent's.

## Acceptance

- Each mode is distinguishable from every other without reference to colour —
  asserted on the rendered markup, not by eye.
- A dash pattern renders correctly on a frame a few units wide: a fixture trip
  inside ~10 km draws a dashed leg with more than one dash in it.
- A flight is visibly more curved than a walk over the same two points.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` and `npm run build` pass.
