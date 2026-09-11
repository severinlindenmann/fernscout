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
