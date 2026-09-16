---
id: B1813
title: The route map often reads as an empty frame with overlapping place names
type: FEATURE
priority: high
complexity: high
area: photobook, route map
found: "2026-09-16T18:11:00Z"
---

# B1813 — The route map often reads as an empty frame with overlapping place names

## Why

Reported by the owner on 2026-09-16: the "Routenkarte mitdrucken" page often
does not look good. Place names overlap each other, the frame covers far more
ground than the journey does, and a trip inside one country reads as almost
nothing at all.

B1000 already took two passes at the framing — the padding floor came down from
6 map units to 1.2, and `centreAwayFromFold` stopped sliding the fold past the
last stop — and it closed saying what was left was geometry that "needs a
decision rather than a patch". This is that ticket.

Three separate faults, all confirmed by reading:

**The frame is forced to an aspect the route does not have.** `routeView`
(`lib/photobook/plan.ts:2015-2076`) pads the route's bounding box by 15%, then
stretches whichever axis is short until the box matches a target ratio. That
reshape, not the padding, is what leaves the empty space: a compact or
north–south journey has its short axis expanded to fill a 2:1 spread, so the
route occupies a fraction of the width however it is placed.

**The target ratio is hardcoded to 2 and is wrong for the portrait book.** The
spread branch (`plan.ts:1531`) calls `routeView(plottable)` with no aspect
argument, so it always assumes 2:1. That is right for the three square trims but
not for 210×280, whose spread is 420×280 — 1.5:1. `mapProjector`
(`plan.ts:2092-2120`) then cover-fits a 2:1 view onto a 1.5:1 page, scaling one
axis harder than the other and cropping the frame away from what `routeView`
computed.

**Label collision is only checked against the previous stop in travel order.**
`routeLabelPlacements` (`plan.ts:2182-2220`) drops a label when it is within 9 mm
of the **last labelled stop in itinerary sequence** — `Math.hypot(...) > minGap`
against `lastLabel` alone. Two stops near each other on the page but far apart in
the journey — a loop, an out-and-back, a region revisited — are never compared,
and both get printed on top of each other. There is no repositioning, no
stacking, no leader lines: a label either prints at a fixed size beside its dot
or is dropped entirely.

**And there is nothing under the route.** `lib/worldLand.json` is 1:110m
coastline with points about 63 km apart, so at a one-country zoom there is no
coastline in frame and the page falls back to bare graticule
(`lib/photobook/graticule.ts`), which is why an empty frame is what it is.

What the trip already offers a map, with no new plumbing: per-stop `location`,
`country`, `countryCode` (ISO-2), `lat`, `lng`, one point per day's lead entry
(`lib/photobook/source.ts:301-315`, `routeFor`) — note this is day coordinates,
**not** the GPS track. Trip start and end dates, the day count, and nights per
country where the costs capability is on.

What geodata is already in the repository:

- `lib/worldCountries.json`, 148 KB — **filled country polygons**, one SVG path
  per ISO-2 code plus a label centroid, in the same equirectangular 1000×500
  space the map already draws in. Already used by `components/LifetimeMap.tsx`;
  the book's renderer has simply never imported it. `toPdfPath`
  (`lib/photobook/worldland.ts:74`) will draw it as-is.
- `lib/mapdata/basemap.json.gz`, 6.7 MB gz — Natural Earth 10m: borders, relief,
  glaciers, lakes, rivers, parks, roads, railroads, peaks, and `admin1` as
  boundary **lines**.
- **No sub-country polygons.** Region fills for a single-country trip would mean
  fetching `ne_10m_admin_1_states_provinces` through
  `scripts/build-mapdata.mjs`, extending `lib/basemap.ts`'s bundle and clip, and
  giving the renderer a fill path. A real addition, tens of megabytes at source.

## Work

**Blocked on a decision, and the decision needs pictures.** The owner asked on
2026-09-16 for two or three worked alternatives to look at before anything is
built — for example colouring the countries visited instead of drawing a line,
or, when a trip stays inside one country, colouring the regions instead. The
artifact is the deliverable of that step; this section gets rewritten with the
chosen treatment before the ticket leaves `open/`.

Whatever is chosen, three things are in scope because they are wrong regardless:

- Pass the spread's real aspect to `routeView` instead of the hardcoded 2, so the
  portrait trim stops being cover-fitted out of shape.
- Make label collision a check against every label already placed, not only the
  previous one in travel order, and give it somewhere to go — an alternative side
  or a small offset — before dropping the name.
- Decide what a frame with no coastline in it shows, rather than falling through
  to graticule.

Not doing: the GPS track. The book's route is day coordinates and stays that way
(see the GPS rule in AGENTS.md).

## Acceptance

- The chosen treatment, rendered as a real PDF for at least three trips of
  different shape: one compact single-country trip, one long multi-country trip,
  and one in the portrait 210×280 trim. Inspected as drawings, via
  `check-a-drawing`, not asserted from a fixture.
- No two place names overlap on any of those three.
- The route fills a reasonable share of its page in all three; a compact trip no
  longer prints as a thumbnail squiggle in an empty frame.
- `npm run verify` green, with the label-collision rule covered by a test that
  fails on `main` for a loop route.

## What the research found — 2026-09-16

Two rounds. The owner rejected the first set of options as "buggy and not
nice", which was fair: they were drawn in a plate carrée stretched to the
frame, with a graticule standing in for land.

**No map stack is warranted.** Everything actually broken is fixed by three
things that need no provider, no account and no tile server:

- **A projection chosen per route extent.** `d3-geo` (ISC, one dependency,
  ~227 KB source) is usable as pure mathematics — `projection([lng, lat])`
  returns `[x, y]`, and `d3.geoPath().context(...)` accepts any object with
  `moveTo`/`lineTo`/`closePath`, so the adapter onto `PdfBuilder` is about
  twenty lines. No DOM, no browser. Conic equal-area for a route that runs
  east-west, azimuthal equal-area for a compact one.
- **Figure-ground instead of graticule.** Land as a filled tone, water as a
  second. `lib/worldCountries.json` is already here; for print the 1:50m
  country set (`world-atlas`, ISC, 756 KB, Natural Earth, public domain) is
  the right resolution. The 10m detail layers this repository *already ships*
  in `lib/mapdata/basemap.json.gz` — relief, glaciers, lakes, rivers, borders,
  peaks — are what stops a close frame being one flat fill, and the book's
  renderer has never drawn them.
- **Label placement that considers every placed label.** The literature
  algorithm is simulated annealing over candidate positions with an energy
  function penalising overlap and anchor distance (Christensen/Marks/Shieber
  1995), which is what `d3-labeler` implements — unmaintained since 2018 and
  coupled to `getBBox()`, so reimplement the ~150-line core against the
  Helvetica metrics in `lib/photobook/text.ts` rather than depend on it.
  `labelgun` is the simpler greedy alternative if dropping a label is
  acceptable.

**A fourth thing, learned by drawing it.** Framing on the whole route puts the
flight in and out across the page and squeezes the actual journey into a
corner. Polarsteps drops the transit legs on purpose. A leg far longer than
the median is not part of the trip's geography.

**Region fills for a single-country trip need data that is not here.** Only
admin-1 *lines* are shipped (11 932 segments). The polygon set
(`ne_10m_admin_1_states_provinces`) is public domain but tens of megabytes
raw; it would go through `scripts/build-mapdata.mjs`, stripped by mapshaper to
the countries a trip touches.

**Free, self-hostable alternatives, if street-level detail is ever wanted:**
Protomaps/PMTiles is the one that needs no account and yields real vector
geometry — but it hands over MVT tiles to decode, not print-ready art.
MapLibre-native and mbgl-renderer end in a raster that is soft at 300 dpi.
Mapnik is the classic print renderer and a heavy native dependency.

Options drawn for the owner, with real routes from `content/example`:
`https://claude.ai/artifact/TeaPRjdWuNn77ULDoWknwo`
