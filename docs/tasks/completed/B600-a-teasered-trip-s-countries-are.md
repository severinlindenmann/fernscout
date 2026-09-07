---
id: B600
title: A teasered trip's countries are missing from the lifetime map
type: FEATURE
priority: medium
complexity: low
area: trips, map
found: "2026-09-06T14:39:19Z"
merged: "2026-09-06T14:43:23Z"
completed: "2026-09-07T13:12:21Z"
---

# B600 — A teasered trip's countries are missing from the lifetime map

## Why

B587 put a locked card on `/<user>/trips` for a closed trip its owner asked to
have named, and deliberately kept it off the lifetime map. On a journal whose
only trip is teasered that leaves the page's largest element blank: no map at
all, because `app/[user]/trips/page.tsx` framed and drew it from `routes`,
which is built from the readable trips alone. The owner asked for the map to
show these trips as well.

## Work

Country-level and nothing more. A teasered trip fills the countries its
**published** days reached and appears in the map's legend; it contributes no
stop, no route line and no coordinate — not even to the frame, which reads the
country's own outline (`countryCorners`, inverting `project`) so that a
bounding box round somebody's actual stops never reaches a public page. It
stays out of the four lifetime figures, which count what this reader may read.

Not doing: the route line, pins, place names, or the trip's days in the
totals. The choice was made explicitly — the alternative published every
stop's coordinates.

## Acceptance

`npx vitest run test/trip-teaser-page.test.tsx` — the payload for a reader who
may not open the trip contains its country and neither its coordinates, its
place names, nor a draft day's country.
