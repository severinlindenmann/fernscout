---
id: B361
title: The lifetime map cannot answer which countries somebody has been to, only where individual stops fell
type: FEATURE
priority: medium
complexity: high
area: maps, trips
found: "2026-09-04T20:15:00Z"
started: "2026-09-04T20:12:15Z"
merged: "2026-09-04T20:28:24Z"
completed: "2026-09-05T08:37:07Z"
---

# B361 — The lifetime map cannot answer which countries somebody has been to, only where individual stops fell

## Why

Asked by the owner on 2026-09-04, looking at the deployed `/<user>/trips`.

The lifetime map plots one pin per stop. At world scale that fails wherever a
trip is dense: fifteen stops across Thailand, Laos and Vietnam render as fifteen
overlapping stems and heads that merge into an unreadable coloured smear, while
a one-stop trip beside it looks fine. Same map, same zoom. The docblock in
`components/LifetimeMap.tsx:28-44` records an earlier pass at this — a solid
teardrop was replaced by a thin stem and small head *because of clustering* —
so this is the second time the symbol has been made smaller to buy legibility,
and it has run out of room.

The deeper point is that the symbol is answering the wrong question. This map
exists to say **everywhere we have been**, and at world scale the honest unit of
"where" is a country, not a coordinate. Fifteen pins in Thailand and one pin in
Thailand mean the same thing to a reader at this scale: *they went to Thailand*.
Drawing fifteen is what makes it ugly and adds nothing.

**Marker clustering was researched and is not what we are building.** The
finding, kept because it is the fallback if the below proves wrong: cluster each
trip's points independently (never across trips — it breaks the colour/legend
contract), greedy agglomerative at a threshold of ≈7 SVG units (≈2.7× the
current pin diameter), radius `1.3 * sqrt(N)` clamped to `[1.3, 4.5]`, no stem
on a multi-stop cluster, larger clusters drawn first. Explicitly *not* the
Flannery perceptual correction — it addresses magnitude ranges spanning orders
of ten, and at N≤20 it differs from plain √N by less than a pixel.

## What was decided, and by whom

The owner chose both of these on 2026-09-04. They are not the implementer's to
revisit without asking:

- **A country visited on several trips is one hue, darker the more visits.**
  Not per-trip colours with the most recent winning (it silently hides that you
  went twice), and not a split or striped fill (it is unreadable on small
  countries and gets worse at three trips — the failure the pins already have).
  The legend therefore stops being a list of trip names and becomes a scale:
  *1 visit / 2 / 3+*. Trip identity moves into hover and click.
- **Go straight for this rather than polishing the pins first.**

The demo journal already contains the overlapping case: the United States is
covered by both `usa-2026` and `parks-2025`.

## Why it is not a small change

`Basemap.borders` is a `string[]` (`lib/basemap.ts:70`) — bare SVG path data
with the country identity thrown away. `lib/worldLand.json` is the same, built
from `world-atlas/land-110m.json`, which has no countries in it at all. Nothing
in the rendering path can currently say *this shape is Thailand*.

Established as feasible before writing this:

- `world-atlas/countries-110m.json` is already a devDependency, needs **no
  network**, and carries 177 features each with an ISO 3166-1 numeric `id` and a
  `properties.name`.
- 161 of those 177 names match `lib/countryCodes.ts` (name → alpha-2) directly.
  The 16 that do not are Natural Earth abbreviations — `Dem. Rep. Congo`,
  `Bosnia and Herz.`, `Côte d'Ivoire`, `W. Sahara` and so on — which a small
  alias table in the build script covers.
- `LifetimeMap` is already `"use client"`, so hover and click need no
  architectural change.

## Work

1. **A new baked data file, rather than reworking the basemap pipeline.**
   `scripts/build-world-countries.mjs`, modelled on the existing
   `build-world-map.mjs`, emitting `lib/worldCountries.json` as
   `{ code, name, path }[]` from `countries-110m`. Self-contained: it does not
   disturb `basemap.json.gz` (6.7 MB, per-frame clipped, built from network
   fetches) or `worldLand.json`, and 110m is the right resolution for a
   world-scale overview. Carry the alias table for the 16 names here.
2. **Resolve visits per country.** Each trip contributes the set of countries
   its stops fall in. A country's intensity is the number of *trips* that
   reached it, not the number of stops — two trips to the US is darker; fifteen
   stops on one trip is not.
3. **Render the fill**, replacing the pins on this map only. `WorldMap` (the
   per-trip map) is untouched and keeps its stops and its route line.
4. **Hover and click.** Hover raises the country slightly and names the trips
   that went there; clicking goes to the trip. Decide what a click does when
   several trips share a country — a country with three trips has no single
   destination, and picking the most recent silently is the trap the colour
   decision already rejected. Offer the list, or make the hover surface the
   links.
5. **Accessibility is the part most likely to be skipped.** The `<svg>` is
   `role="img"` with one `aria-label`, which is right for a picture and wrong
   for something focusable. If countries become activatable they need real
   accessible names and keyboard reach, or `role="img"` has to stay and the
   links must exist in page text beside the map. A non-visual reader must be
   able to get "which countries, on which trips" without the map — the trip
   cards below may already satisfy this; check before adding anything.
6. **What a journal with no country data sees.** `viki`'s fifteen days carry
   `country: ""`, so a naive implementation renders an empty world for them —
   worse than today. Either derive the country from `lat`/`lng` by
   point-in-polygon against the same shapes (which removes the dependency on
   frontmatter entirely and is the reason to prefer it), or keep the pins as the
   fallback when no country resolves. Do not ship the empty world.

Not in scope: B46 (a one-city journal framed to a map thousands of kilometres
wide); the per-trip `WorldMap`; widening the accent palette.

## Acceptance

- The demo journal fills seven countries, with the United States visibly darker
  than Switzerland or Thailand because two trips reached it.
- A journal whose days carry no `country:` still renders something truthful.
- Hovering a country names the trips that went there; the keyboard reaches
  whatever the mouse can activate.
- The per-trip map at `/<user>/map` is pixel-identical to before.
- `lib/worldCountries.json` is regenerable from `npm run` with no network.
- `npm run verify`, and `npm run unused` for the new script and data file.

---

**2026-09-05, verified on fernscout.ch (f01c97b): passes, minus one bullet that
a later ticket deliberately reversed.**

Countries are filled and each is reachable: a single-trip country renders as a
real `link` naming its trip, and the one multi-trip country is a
`graphics-symbol` whose accessible name lists both trips rather than picking
one — the "offer the list" resolution this ticket asked for. `/<user>/map` is
untouched and still draws its route line over ringed stops.

The colour-intensity bullet — the United States darker than Switzerland because
two trips reached it — **no longer describes the system, by decision**. B370,
merged about half an hour later, moved visit count off the map and into the
legend, where it now reads "United States ×2". That bullet is superseded by
B370 rather than failed.
