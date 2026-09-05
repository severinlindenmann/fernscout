---
id: B344
title: The lifetime map joins every trip's stops with a line, reading as a route when it is an overview of everywhere somebody has been
type: FEATURE
priority: medium
complexity: low
area: maps, trips
found: "2026-09-04T19:45:00Z"
started: "2026-09-04T19:42:35Z"
merged: "2026-09-04T19:48:08Z"
session: 62683d95-33a6-4db0-a254-7a8fcbcf014e
claimed: "2026-09-05T08:24:20Z"
---

# B344 — The lifetime map joins every trip's stops with a line, reading as a route when it is an overview of everywhere somebody has been

## Why

Asked by the owner on 2026-09-04, looking at `fernscout.ch/viki/trips`.

`components/LifetimeMap.tsx:136-146` draws a `<polyline>` through each trip's
stops in the trip's accent colour, under the pins. On the per-trip map
(`WorldMap`) a line is right: that page is one journey, in order, and the line
*is* the journey. On `/<user>/trips` it is not. That map answers a different
question — **everywhere we have been** — across trips that are unrelated to each
other, and a line between stops asserts a sequence and a path that the page is
not claiming and often did not happen. Two stops joined by a straight line over
an ocean read as a crossing; they were two separate holidays.

It also has to hold for readers whose travel is nothing like each other's: a
journal covering three continents, one covering a handful of European cities,
one that never leaves a single country. A route line is progressively more
misleading as the frame tightens, because the shorter the real distance the
more the straight line looks like an actual road.

The pins already carry everything the overview needs: position, and the accent
colour that the legend below ties back to each trip by name.

## Work

- **Remove the `<polyline>` from `LifetimeMap`.** Pins only. `WorldMap` is
  untouched — the per-trip map keeps its route, which is correct there.
- The `pts.length > 1` guard exists only for the polyline; it goes with it. A
  one-stop trip already renders its single pin.
- `test/lifetime-map.test.tsx:69` — *"a pin's tip sits on the coordinate the
  route line joins"* — verifies pin placement by reading the polyline's points
  and comparing. With no polyline it has no oracle, so re-anchor it on the
  projected coordinates directly rather than deleting it: the property it
  guards (B88 — a pin's *tip* is the coordinate, not its centre) is still worth
  holding and is unrelated to the line.
- Leave the legend, the accent colours and `aria-label` alone. `trips.mapLabel`
  is "All our trips" and does not claim a route, so no locale change.
- Not in scope: **B46** — a journal whose stops sit inside one city still frames
  to a map thousands of kilometres wide. That is the other half of "works for
  every traveller" and is a framing question in `frameRoute`, not this one.
  Removing the line does not fix it and must not be confused for fixing it.

## Acceptance

- `/<user>/trips` renders no `<polyline>`, and one pin per plottable stop.
- A trip with a single stop, and a journal with a single trip, both still draw.
- The per-trip map (`/<user>/map`) still draws its route line — unchanged.
- `test/lifetime-map.test.tsx` still asserts the pin-tip property, without
  reference to a polyline, and fails if a pin is centred on its coordinate.
- `npm run verify`.
