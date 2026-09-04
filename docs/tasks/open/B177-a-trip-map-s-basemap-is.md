---
id: B177
title: A trip map's basemap is half a megabyte for a route sixty-eight kilometres across
type: ISSUE
priority: medium
complexity: medium
area: maps, payload
found: "2026-09-03T19:36:52Z"
---

# B177 — A trip map's basemap is half a megabyte for a route sixty-eight kilometres across

## Why

Measured while building **B85**, which was about a basemap nobody could see.
This is the other half: the basemap people *can* see, and what it weighs.

`basemapFor` (`lib/basemap.ts`) clips 1:10m Natural Earth to any frame under
`DETAIL_BELOW_KM` (900 km) with no ceiling on how much comes back. For
`alps-2024` — four stops inside 68 km — the clipped basemap serialises to
**518,867 bytes**, and the whole trip page comes to **1,091,637 bytes** over
`next dev`. `parks-2025` is 475,698. By comparison the whole-world basemap,
which falls to 1:110m outlines, is 159,317.

So the closer in a trip is framed, the more it pays, and the current scale
ceiling is the only thing holding it. B46 records why the detail is there and
it is a good reason — an inland trip drawn on 1:110m coastline is a blank
green field. The question this raises is a different one: whether *every*
shape whose bounding box overlaps a 68 km frame has to travel in full, at full
coordinate precision, with a half-frame pad on each side.

On a phone on mobile data that is a megabyte for one trip's overview.

## Work

Not decided. Things worth measuring before choosing:

- Which layers dominate at a close frame — `relief`, `rivers`, `roads` and
  `railroads` are the suspects, and each is already switchable per band.
- Coordinate precision in the baked path text (`scripts/build-mapdata.mjs`).
  At 68 km a coordinate carrying six decimals of a projected unit is spending
  bytes on millimetres.
- Whether the half-frame pad (`const pad = frame.w * 0.5` in `basemapFor`)
  earns its ~2.25× area on a map that does not pan.
- Whether a shape crossing the frame should be clipped to it rather than sent
  whole — one Swiss canton polygon is most of one, and the frame shows a
  tenth of it.

Explicitly **not** in scope: `frameRoute`, and the guard B85 added. This is
about the size of a basemap that is genuinely drawn.

## Acceptance

- A measured before/after for `alps-2024` and `parks-2025`: bytes of basemap
  JSON, and bytes of the trip page's response.
- The map still says what B46's tests assert it says — borders, water, towns
  and peaks for an inland Alpine frame (`test/basemap.test.ts`).
- No change to which frames get which resolution band, unless the measurement
  says the band is the problem.
