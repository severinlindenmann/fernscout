---
id: B177
title: A trip map's basemap is half a megabyte for a route sixty-eight kilometres across
type: ISSUE
priority: medium
complexity: medium
area: maps, payload
found: "2026-09-03T19:36:52Z"
started: "2026-09-04T06:43:31Z"
merged: "2026-09-04T07:30:27Z"
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

**Done: the geometry is cut to the box, not just selected by it.**
`lib/mapClip.ts` clips a baked path to the padded frame before it is
serialised — Sutherland–Hodgman for the filled layers, Liang–Barsky per
segment for the stroked ones — and `clip()` in `lib/basemap.ts` calls it for
every shape that is not *wholly* inside the box. A contained shape is passed
through untouched, which is what keeps a continental map byte-for-byte what it
was.

That was the fourth of the four things the Work section listed, and it turned
out to be the only one worth doing. What the measurements said about the other
three:

- **Which layers dominate.** Not the suspects. On `alps-2024` the `borders`
  layer alone was 465,472 of the 518,867 bytes — seven country polygons, of
  which Switzerland and Italy are most — against `glaciers` 21,876,
  `railroads` 15,417 and `roads` 8,948. Dropping a whole layer would have cost
  the map something visible and saved a tenth of what clipping saves.
- **Coordinate precision.** Already right. The bake writes two decimals, a
  400 m grid, and B46 measured the source at a 1.6 km median between points.
  At a 186 km frame drawn 900 px wide, 400 m is three pixels: the data is
  coarser than the screen, not finer. Nothing to reclaim, and the same
  reasoning says a *coarser* grid would be visible. The clipper does trim
  trailing zeros (`12.30` → `12.3`), which is free.
- **The pad.** Its premise was wrong and the task file now says so — the map
  does pan, `WorldMap` has drag handlers — so it cannot simply go. Measured
  both ways anyway, since clipping changed what it costs from *whole shapes
  admitted* to *area kept*: at 0.25 instead of 0.5, `alps-2024` is 41,439
  rather than 64,616 and `usa-2026` 40,278 rather than 85,436. Left at 0.5,
  and it now has a second job — the cut edges a clip leaves behind are stroked
  as if a border ran there, and the pad is what keeps them off the screen.

**Not done, deliberately:** no change to the bands, the bake, or which frame
gets which resolution — the measurement said the band was not the problem, and
`asia-2023` (16,702 km, coarse band) is within 2% of where it was.

## What it cost, measured

`content/example`, `basemapForRoute` on each trip's own route, bytes of
`JSON.stringify(basemap)`; pages over `next dev`, `curl -o /dev/null -w
%{size_download}`, warm.

| trip | frame | basemap before | after | page before | after |
| --- | --- | --- | --- | --- | --- |
| `alps-2024` | 186 km | 518,867 | **64,616** | 1,092,881 | **192,102** |
| `parks-2025` | 2,591 km | 175,769 | **49,883** | 488,084 | **236,247** |
| `usa-2026` | 3,287 km | 217,807 | **85,436** | 531,511 | **266,693** |
| `japan-2027` | 3,122 km | 186,746 | **81,332** | — | 247,494 |
| `asia-2023` | 16,702 km | 146,333 | 143,979 | 405,890 | 401,130 |
| whole world | 40,075 km | 159,317 | **159,317** | — | — |

(Pages are `/example/trips/<trip>` for `alps-2024` — the figure the task was
filed on — `/example/map` for `usa-2026`, which is the current trip and whose
`/example/trips/usa-2026/map` is a 307 to it, and `/example/trips/<trip>/map`
for the rest. The page carries the basemap twice, once as rendered SVG and
once as the props React hydrates from, which is why 454 KB off the basemap
takes 900 KB off the page.)

Three things the table is there to prove:

- the trip the task was filed on drops by **87.6%**, and its page by 82.4%;
- a **continental** map does not get worse — `asia-2023` improves slightly and
  the whole-world basemap is **byte-identical**, because at that width every
  shape is contained and the clipper is never called;
- the win is not confined to close frames: the mid band (`parks-2025`,
  `japan-2027`, `usa-2026`) is where a country polygon is largest relative to
  the frame, and it halves or better there too.

Cost of the clip itself, same measurements: ~3 ms per frame (`parks-2025`
1.4 ms → 3.9 ms, `japan-2027` 0.7 ms → 3.2 ms) against a bundle load of ~90 ms
that happens once per process.

## What was stale in the Why

- **`parks-2025` is not 475,698 bytes of basemap.** It is 175,769, and 488,084
  is what its *map page* weighs — which is probably the number that was
  written down. Left in the Why as filed; corrected here.
- **"a map that does not pan"** — it pans. `components/WorldMap.tsx` has
  `onPointerDown`/`onPointerMove` and a `pan` state, and the pad is what a drag
  runs into. See the Work section above for what that changed.

## Acceptance

- ✅ Measured before/after for `alps-2024` and `parks-2025`, basemap and page
  bytes, in the table above.
- ✅ `test/basemap.test.ts` — B46's assertions (borders, water, towns, peaks,
  no stacked labels, everything inside the frame) all still pass on the same
  inland Alpine frame, plus four new ones: the basemap weighs kilobytes, the
  filled layers come back closed and the stroked ones open, and no coordinate
  lands outside the padded box.
- ✅ No change to which frame gets which resolution band.
- ✅ `test/mapClip.test.ts` — nine unit cases for the clipper, including the
  two that a naive "drop the points outside" gets wrong: a polygon that
  swallows the frame (its fill *is* the land) and a line that leaves the box
  and returns (two strokes, not one chord across the gap).

## Verified

`npm ci && npm run build && npx tsc --noEmit && npx eslint . && npx vitest run`
in the worktree: build ok, tsc clean, eslint 0 errors (4 pre-existing
warnings), **122 files, 1995 passed, 2 skipped** — the two skips are the
Postgres ones, and there are no map skips left (see B179).

Looked at on `next dev`: `/example/trips/alps-2024/map` at 1200×1000 draws
land, ice, Lago Maggiore, the rivers, the passes' roads and the canton
boundaries, with no cut edge anywhere in the frame.

And measured rather than eyeballed. The same viewport screenshotted against
the branch point and against this branch differs in **3 of 3,600,000 channel
values, maximum delta 4/255**, at one pixel on the map's bottom edge — the
same picture, for 87.6% fewer bytes.
