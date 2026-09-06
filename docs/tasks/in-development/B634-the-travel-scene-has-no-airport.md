---
id: B634
title: The travel scene has no airport
type: FEATURE
priority: low
complexity: low
area: travel scene, buildings
found: "2026-09-06T17:51:46Z"
started: "2026-09-06T18:18:41Z"
session: e5f23c58-bb87-4175-ad7b-5d3aed93169f
claimed: "2026-09-06T18:18:41Z"
---

# B634 — The travel scene has no airport

## Why

The travel scene draws skylines behind the journey, and there is no airport —
which is the one building a travel journal most often needs, since a flight is
the most common leg. `components/TravelScene.tsx` holds the skyline layer;
`surfaceFor()` in `components/travel/Ground.tsx:27` is the equivalent
mode-to-scenery mapping already there for the ground.

## Work

- One more building kind: an airport. A terminal and a tower is enough; this is
  a silhouette, not a model.
- Look at it on `/docs/branding/animation` before calling it done —
  `check-a-drawing` is the procedure, and a drawing is the one thing no test
  checks.

## Acceptance

- The airport appears in the skyline on `/docs/branding/animation`, and looks
  right beside the existing buildings at the sizes the scene uses.
