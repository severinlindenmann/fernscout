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

## What shipped

Buildings in `components/Cityscape.tsx` are not chosen by mode at all — the
skyline is generated per place (hashed from the name, sized from population,
with `kind` — flat/pitched/spire/dome — rolled per building). Rather than
invent a second selection mechanism, `Cityscape` gained an `airport?: boolean`
prop and a fifth `kind: "airport"`, and `TravelScene.tsx` passes
`airport={isFlight}` to both the departure and arrival `<Cityscape>` calls —
so a flight leg's two skylines each get one, appended after the usual random
buildings (drawn last, so it sits in front, at the city's edge).

Its width is reserved *before* the main building loop runs (`loopWidth = width
- airportW - 8`), not tacked on after — an early version added it only "if
there's room left," which for a mid-size or large city was never true, since
the random buildings already filled the frame. Confirmed both departure and
arrival `<svg>`s contain the airport's mast rect at populations of 120,000 and
2,000,000.

Drawn as: a low, wide terminal block (same body rect every building uses) with
a flat roof cap, plus a thin control-tower mast rising off one end topped with
a wider, rounded cab that overhangs the mast on both sides (a T-shape) — the
"flared top" the ticket asked for. Uses the same `WALLS`/`ROOFS` palette every
other building draws from, so it stays in-palette automatically.

Verified on `/docs/branding/animation`: set MODE to `flight`, held a moment
mid-leg. Screenshotted and cropped both skylines — the airport reads clearly
as a terminal-plus-tower beside a spire, a dome, and plain blocks, at the
scene's actual size (dev server on port 3411, chrome-devtools MCP).
