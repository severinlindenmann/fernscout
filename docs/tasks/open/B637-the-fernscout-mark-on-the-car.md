---
id: B637
title: The Fernscout mark on the car sits too far off centre
type: ISSUE
priority: low
complexity: low
area: branding, travel scene
found: "2026-09-06T17:51:55Z"
---

# B637 — The Fernscout mark on the car sits too far off centre

## Why

The Fernscout mark on the car in the travel scene sits too far towards one end
of the body. On a small vehicle at small sizes it reads as an accident rather
than as branding. `components/travel/Vehicle.tsx:161` is where the wordmark is
placed.

## Work

- Move the mark towards the centre of the car's body.
- Check it on `/docs/branding/animation` at the sizes the scene actually uses,
  including the slider held mid-leg — `check-a-drawing` is the procedure, and
  its note about `originX` being a fraction of the bounding box is the trap
  waiting here.

## Acceptance

- The mark is visually centred on the car at every size the animation bench
  shows.
