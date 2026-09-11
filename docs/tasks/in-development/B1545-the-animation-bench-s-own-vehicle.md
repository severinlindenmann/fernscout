---
id: B1545
title: The animation bench's own vehicle list predates metro/tram/ferry, so B1519's new modes are invisible there
type: ISSUE
priority: low
complexity: low
area: ui, branding
found: "2026-09-11T21:45:30Z"
started: "2026-09-11T21:45:55Z"
session: bfe90fb0-0095-4532-8af8-601ad489b14c
claimed: "2026-09-11T21:45:55Z"
---

# B1545 — The animation bench's own vehicle list predates metro/tram/ferry, so B1519's new modes are invisible there

## Why

Asked live, on `/docs/branding/animation`: *"metro where?"*

B1519 added `metro`, `tram` and `ferry` to `TRANSPORT_MODES` in
`lib/validate/entry.ts`, and the drawing itself is real —
`lib/travel/vehicleShapes.ts` gives `metro`/`tram` `train`'s carriages in a
smaller box, and `ferry` reuses `boat`'s hull. None of it shows up on the
bench, because `components/branding/AnimationWorkbench.tsx` keeps its own
hand-typed `MODES` array — `flight, train, bus, car, taxi, motorbike,
bicycle, boat, walk` — that predates B1519 and was never touched by it. The
"Mode" selector and the "Vehicles" grid both iterate this local list, so the
three new modes are unreachable on the one page built to hold a drawing
still and look at it. This is exactly the enum-typed-out-instead-of-imported
pattern AGENTS.md warns about, one level down from the API layer.

## Work

Import `TRANSPORT_MODES` from `lib/validate/entry.ts` and derive the bench's
list from it (`Exclude<TransportMode, "walk">` where `walk` needs separate
handling, same as `PrintableMode` already does in `lib/travel/vehicleShapes.ts`)
rather than keeping a second hand-typed array that will fall behind the next
mode too.

## Acceptance

- `metro`, `tram` and `ferry` are selectable in the animation bench's "Mode"
  control and appear in the "Vehicles" grid.
- The bench's mode list is derived from `TRANSPORT_MODES`, not a second
  literal.

## Also done, from live design feedback on the bench (2026-09-12)

Once metro was actually visible, its own drawing was next: it was reusing
`train`'s two carriages and a locomotive with a boiler and a chimney, which
nobody has met at a station. Picked from a set of drafts (an artifact laying
out three vehicle styles and three underground treatments), the owner chose
"one long liner" + "full tunnel", then asked for it built up further from
there in several rounds against the live bench:

- **`lib/travel/vehicleShapes.ts`** — `metro` is now its own case in
  `vehicleBody`/`vehicleWheels`/`vehicleTitles`: one continuous welded shell
  (door seams as the only break, a blunt rounded nose) rather than two
  carriages behind a steam locomotive. `tram` is untouched and still reuses
  `train`'s shapes, since a tram runs at street level.
- **`components/travel/TunnelWall.tsx`** (new) — a dark brick band with
  lamps, standing on `Ground`'s own rail line, only when `mode === "metro"`.
- **`components/travel/Skyline.tsx`** (new) — a dense, full-width, generic
  skyline (there is no third place name to draw it from) standing on the
  tunnel's own roof, reusing `Cityscape`'s `BuildingShape`/palette rather
  than a second one. The two named `Cityscape`s (departure/arrival) were
  raised to stand on the same roofline underground — they used to stay at
  ground level and go half-buried behind the wall, which read as a building
  cut off mid-render.
- **`components/travel/Ground.tsx`** — a `dark` prop swaps the rail bed's
  grass verge and ballast for grey stone when underground; there is nothing
  growing under a tunnel.
- **`components/TravelScene.tsx`** — wires all of the above behind one
  `underground = mode === "metro"` flag, and `VEHICLE_WIDTH.metro` went from
  110 (a fraction of `train`'s width, B1519's original choice) to 420 —
  roughly twice `train`'s own 210, after two rounds of "still too small"
  against the standing skyline.
- **`components/Cityscape.tsx`** — exported `WALLS`, `ROOFS`, `hashString`,
  `mulberry32` (previously module-private) so `Skyline` draws from the same
  palette and the same seeded-randomness rule rather than a duplicate.

Verified on the bench itself (`/docs/branding/animation`, Mode: metro, Hold
at a moment ~50%): the vehicle, the tunnel, the full-width skyline standing
clear of the wall, and the grey rail bed all read correctly together.
`npm run verify`: 542 test files, 7085 passed / 4 skipped (Postgres-only),
knip clean.
