---
id: B46
title: A trip that stays inside one city draws as a single dot on a map thousands of kilometres wide
type: ISSUE
priority: medium
complexity: medium
area: map, ui
found: "2026-09-01"
started: "2026-09-01"
merged: "2026-09-01"
---

# B46 — A trip that stays inside one city draws as a single dot on a map thousands of kilometres wide

## Why

Every map here is one baked equirectangular world in a 1000×500 viewBox
(`lib/mapProjection.mjs`). One unit is 0.36° — about **40 km** at the equator.
That is the smallest thing the coordinate space can express, and everything
built on top assumes a route measured in continents.

Four separate constants each independently break a short trip.

**The framing padding is fixed and continental.** `WorldMap.tsx:107` pads the
route's bounding box by `padX = 70`, `padY = 55` units. Whatever the route
actually spans, the view is at least 140 units wide — **roughly 5,600 km**. A
weekend across one city spans a quarter of a unit, so the bounding box is
effectively a point and the map draws a 5,600 km view of a continent with one
marker in the middle. `MiniMap.tsx:24` is worse at 90/60, about 7,200 km.

**Zoom cannot recover it.** `WorldMap.tsx:278` caps zoom at 8. Dividing a
5,600 km base view by 8 leaves ~700 km across at maximum zoom — still a
country, never a city.

**The stops merge into one marker.** `clusterPlaces` uses a merge radius of
`16 / zoom` units (`WorldMap.tsx:37`) — 640 km at zoom 1, and still 80 km when
fully zoomed in. Every stop on a city trip collapses into a single cluster at
every zoom level the UI offers, so the one marker that is drawn does not even
separate into the places visited.

**There is no coastline to zoom into.** The basemap is baked from
`world-atlas/land-110m.json` (`scripts/build-world-map.mjs:8`) — Natural Earth
1:110m, a resolution whose whole purpose is world views and which simplifies
away everything smaller than roughly 100 km. Fixing the three constants above
would zoom into a blocky green polygon with no recognisable shore, lake or
island. **This is why the task is not a padding tweak**: the geometry to show
at city scale does not exist in the repo.

There is a fifth problem that only appears once you get close. Equirectangular
treats a degree of longitude as a degree of latitude, but at 47°N a degree of
longitude is about two-thirds the distance. At world scale nobody notices. At
city scale a Zurich day trip is drawn visibly stretched sideways, and a route
that ran north-east looks like it ran east.

The author's own content is the case: a trip need not be a six-month crossing
to deserve a map, and the map page is one of the four things in the nav
(`components/SiteNav.tsx:14`). Related: B18 is the same page drawing nothing at
all for a planned trip, and B06 covers route rendering more broadly.

## Measured, 2026-09-01

The basemap question was "can this reach roughly 1 km detail". It was measured
rather than estimated, against the three resolutions `world-atlas` already ships
as a devDependency. **Distance between neighbouring coastline points** — the
finest thing the data can express:

| source | world median | Japan median | 10th pct | baked, whole world |
| --- | --- | --- | --- | --- |
| `land-110m` (current) | 63.1 km | 75.3 km | 35.0 km | 0.06 MB |
| `land-50m` | 7.6 km | 9.8 km | 3.0 km | 0.71 MB |
| `land-10m` | **1.6 km** | 1.7 km | 661 m | 4.90 MB |

So 1 km detail **is** reachable from data already on disk: `land-10m` resolves
to a 1.6 km median, 661 m at the tenth percentile. Three things qualify it.

**The bake throws most of that away before it ships.**
`scripts/build-world-map.mjs:17` writes coordinates with `toFixed(1)` — a tenth
of a viewBox unit, and one unit is 40.1 km, so every point snaps to a **4 km
grid**. At 10m resolution the data would be finer than the grid it is rounded
onto. Three decimals gives a 40 m grid and costs 6.45 MB instead of 4.90 MB.

**The whole world at 10m is 80× the current payload.** `test/bundle.test.ts`
exists because 62 KB of coastline in the shared chunk was considered a bug worth
a permanent test. 4.9 MB is a different category, and it is the entire planet
downloaded to look at one city.

**Clipping to the trip fixes that completely.** The same 10m source, cut to a
trip's own bounding box and kept at 3 decimals:

| area | `land-10m` | `countries-10m` |
| --- | --- | --- |
| Japan, end to end | 126 KB | 144 KB |
| Switzerland | **0 KB** | 39 KB |
| Zurich, 30 km across | **0 KB** | **0 KB** |

Japan at full 10m resolution costs 126 KB — twice today's payload for forty
times the detail, and it ships with the trip rather than with the site.

**And the last row is the real answer.** `land-*` is a coastline: land against
sea, nothing else. Switzerland has no coastline, so an inland journal draws a
blank green field at *every* resolution — `countries-10m` rescues it with 39 KB
of borders, which is why the country file, not the land file, is the right
source. But inside a 30 km box over Zurich **both files are empty**. There are
no lakes, no rivers, no roads, no urban areas in this data family at any
resolution. Below roughly the size of a country there is nothing to draw.

Getting a city to look like a city therefore is not a resolution problem and
cannot be solved by swapping files. It needs a different dataset — Natural
Earth's separate 10m lakes and rivers layers (a new dependency, and enough for
"Zurich is on a lake"), or OSM-derived vector tiles for anything street-level,
which is the hosting decision B06's plan already flags.

## Work

The framing arithmetic is straightforward; the basemap is a decision and should
be made before the rest is built, because it determines whether zooming in is
worth offering at all.

> **Decided by the author, 2026-09-01: the first two options, together.** A
> per-trip clipped basemap from `countries-10m`, and below roughly 30 km no
> basemap at all. OSM vector tiles are not being adopted.
>
> **Widened by the author the same day: "basic mountains, lakes, cities etc
> would be nice."** So the third option is in scope after all. What that costs
> turned out to be much less than this file assumed, because two of the three
> are already solved:
>
> - **Cities need no new dependency at all.** `lib/ingest/data/places.bin.gz` is
>   already committed — every populated place over a thousand people, packed
>   into fixed-size records *sorted by latitude* with a population scale on
>   each (`lib/ingest/geo.ts:24`). It exists so ingest can reverse-geocode a
>   photo with no network. Selecting the most significant places inside a
>   bounding box is a latitude-range scan over an index that is already on
>   disk and already binary-searchable.
> - **Countries** are `world-atlas`, already a devDependency.
> - **Lakes, rivers and peaks** are the only genuinely new data. Natural Earth
>   publishes them as GeoJSON — `ne_10m_lakes`,
>   `ne_10m_rivers_lake_centerlines`, `ne_10m_geography_regions_elevation_points`
>   — and both were confirmed reachable before this was planned.
>
> And there is already a pattern in the repo for exactly this shape of thing.
> `scripts/build-geodata.ts` downloads GeoNames, bakes a compact artefact, and
> commits it, on the stated grounds that *"you are on hostel wifi; the geocoder
> has to already be on the disk. This script exists to refresh it, not to run at
> install time."* The new layers follow it rather than inventing a second way.

**Decide what a close-up map shows.** The measurements above replace what this
section originally guessed. Four options, and the first two are now the
recommendation *together* — they answer different halves of the range:

- **Bake the basemap per trip, from `countries-10m`, clipped to the trip's own
  bounding box.** 126–144 KB for Japan, 39 KB for Switzerland, at ~1.6 km
  resolution. It ships beside the trip's other derivatives under
  `content/<user>/trips/<id>/`, which is where generated output already lives,
  so a long journal never pays for a country it has not visited. `countries-10m`
  rather than `land-10m` because a landlocked trip gets nothing from a
  coastline. This carries the map from continents down to roughly the size of a
  region, which is most of the gap.
- **Below that, stop pretending there is terrain.** Inside a 30 km box there is
  nothing in Natural Earth to draw at any resolution — measured, both files
  empty. So under some span, drop the basemap and put the route and its stops on
  the clean background the brand already uses: an abstract diagram of the day
  rather than a blank green field with pins on it. Honest, free, and for a walk
  across a city arguably the better picture.
- Add Natural Earth's 10m lakes and rivers as well. A new dependency, and the
  smallest thing that would make an inland city read as a place — "Zurich is on
  a lake" — without going near OSM. Worth costing separately if the abstract
  treatment above turns out to feel empty.
- Self-hosted OSM vector tiles (Protomaps/PMTiles, built with Planetiler for
  only the areas a journal covers) are the only route to genuine street-level
  detail. They also mean replacing the SVG map with a GL renderer and losing the
  drawn look entirely, so this is a rewrite, not a setting. It is the same
  hosting decision `docs/plans/W20-tracking.md` defers, and it should be made
  once, for both.

Third-party raster tiles stay rejected unless the author says otherwise: they
make every reader's browser call a service that then learns their IP and which
trip they opened, on a self-hosted journal whose maps are deliberately baked in.

**Fix the bake precision at the same time.** `scripts/build-world-map.mjs:17`
rounds to `toFixed(1)`, a 4 km grid, which would quantise away most of what a
10m source provides. Three decimals is a 40 m grid; per-trip clipping is what
makes that affordable.

**Then make the framing scale-aware.** Pad as a fraction of the route's own
extent with a floor, rather than a fixed 70/55; raise or remove the zoom cap
for short routes; express the cluster merge radius in kilometres rather than
viewBox units so stops separate at any scale. `MiniMap.tsx` needs the same
treatment and currently duplicates the arithmetic — worth extracting one
`frameRoute()` both call.

**Correct the aspect at close range.** Scale longitude by `cos(latitude)` for
the view, or state in a comment why not. A trip crossing a continent does not
care; one crossing a city does.

A single-stop trip is the degenerate case and should be checked explicitly: one
point has a zero-extent bounding box, which is what produces the current
behaviour in its purest form.

**The bake has to notice when the trip grows, and this is the trap.** Today
nothing is generated: every request re-derives the frame from the entry files,
so adding a day in a new country simply reframes the map on the next load. A
per-trip clipped basemap is the first thing on this page that would be
*generated*, and a trip is a thing that grows a stop at a time — a journal that
starts in Bangkok and ends in Hanoi would otherwise keep the basemap it was
first baked with and draw its later half over empty sea.

So the artefact must carry the bounding box it was cut for, and be rebuilt when
the trip's own box no longer fits inside it — checked on read, the way
`lib/entries.ts:85` checks a directory signature, not left to a build step
somebody has to remember to run. Bake with a margin so that ordinary growth
does not re-cut it on every new day, and treat a missing or stale file as
"draw without a basemap" rather than as an error: the abstract treatment above
is already the fallback, so there is a correct thing to render while a rebake
has not happened.

**Not doing:** an interactive slippy map, tile fetching (see above), per-day
GPS traces (B06), or changing what counts as a place.

## What was built, and where this plan was wrong

Written after the work. The plan above is left as it was — it is the reasoning
that led here — but four of its decisions did not survive contact.

**There is no generated artefact, and so no staleness problem.** The plan spent
a paragraph on the trap of baking a basemap per trip into
`content/<user>/trips/<id>/` and having to notice when a trip outgrew it. That
whole section is moot: `lib/basemap.ts` clips on the *server, per request*, from
one committed bundle. A reader still receives only their own frame's worth —
tens of kilobytes, not the 5.9 MB file — and because nothing is written
anywhere, a trip that grows a stop is simply reframed on the next load, exactly
as `getPlaces` already behaves. The cheaper design was available the whole time
and the plan did not see it.

**There is no "too close to draw" threshold either.** The plan proposed
dropping the basemap below ~30 km. Nothing needed to decide that in advance: an
empty clip draws the clean background by itself. One less constant, and the
behaviour is right at every scale rather than at the scale somebody guessed.

**The scope grew, and got cheaper than the plan assumed.** The author asked for
mountains, lakes and cities, then regions, then elevation, then roads and rail.
Cities cost nothing — `lib/ingest/data/places.bin.gz` was already committed for
reverse-geocoding photographs and is sorted by latitude, so a bounding-box query
is two binary searches (`placesInBox`). Country borders were already there the
moment `countries-10m` replaced `land-110m`: each shape is one country, so
stroking the polygons that fill the land gives every frontier for free.

**The fourth constant was not in the plan at all, and it broke the map.** The
plan named three — padding, zoom cap, cluster radius. It missed that every
marker radius, stroke width and font size was *also* a viewBox constant tuned
for a ~140-unit frame. Against the Alps' 4.6-unit frame a radius-8 white marker
was three times wider than the map, and the first working version of the
framing fix rendered as a blank white rectangle. Fixing that as a fraction of
the frame then introduced its twin: a fraction of the width is a different
number of *pixels* on a phone, so labels legible at 13px on a desktop arrived at
5px on a 390px screen. Sizes are now measured screen pixels
(`ResizeObserver` → `px()`), which is the only definition that survives changing
the screen.

Three smaller things, each found by looking at the rendered page rather than by
reading:

- `vector-effect="non-scaling-stroke"` makes `stroke-width` a screen length, so
  passing it a frame-relative value drew every border at 0.016px — invisible.
- Rings crossing the antimeridian drew a straight line across the whole world,
  visible as a stray rule through the Pacific on the lifetime map.
- Natural Earth's summit class is `mountain`, not `peak`, and the geography
  regions file uses UPPER CASE property names where every other file here is
  lower case. Each mistake shipped a layer that was silently empty.

**Two more maps existed than the plan counted.** It named `WorldMap` and
`MiniMap`. `LifetimeMap` on `/trips` held a *third* copy of the framing
arithmetic with a third set of constants, and the trip overview page rendered a
`WorldMap` with no basemap at all. All four share `frameRoute` now.

**Cost, stated plainly.** `lib/mapdata/basemap.json.gz` is 5.9 MB committed,
23 MB parsed, server-side only. That is three times the existing
`places.bin.gz` and it is the one number in this task worth arguing about.
Roads are most of it; the layers are independent and each is one constant away
from being dropped. Urban areas (28 MB of source) were left out for this reason
and not because they would not be useful.

## Acceptance

- A fixture trip whose stops all lie within ~10 km renders framed on those
  stops, not on a continent — assert the computed viewBox width is under a
  stated threshold rather than eyeballing it.
- The same trip's stops render as separate markers, not one cluster, at the
  default zoom.
- A trip spanning continents frames exactly as it does today: a regression test
  pinning the current viewBox for an existing multi-country fixture.
- A one-stop trip renders a sensible view rather than a zero-width box.
- Whatever is drawn at close range is a deliberate choice, with the reason in a
  comment where the threshold is set.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` and `npm run build` all
  pass.

### Sent back from testing, 2026-09-01

The author found two pages still wrong, and both were the same miss:
`components/MiniMap.tsx` — the hero's small map — got the shared frame and
nothing else.

- **`/example/trips/alps-2024` rendered as a solid yellow rectangle.** Its pin
  was `r={9}` *viewBox units*. Under the old fixed padding no frame was ever
  narrower than 140 units and that meant a dot; framed on the Alps it is 4.6
  units, so the pin was twice as wide as the map. Exactly the blank-rectangle
  bug already recorded above, in the one component that had been reframed but
  not resized — which is what happens when a fix is applied by hand three times
  instead of shared.
- **`/example` had no basemap.** `MiniMap` was never given the prop, so it was
  still drawing 110m coastline while every other map had been moved on.

Both fixed: `MiniMap` sizes in measured screen pixels like `WorldMap`, and
takes a basemap. The clip is built in `buildStoryProps` (`lib/tripView.ts`)
rather than at the four routes that render a story, because all four go through
it and none of them otherwise has anything to say about maps.

`test/world-map.test.tsx` now asserts no circle on the mini map is wider than a
quarter of its frame, which is the assertion that would have caught this.

### The clip had no ceiling, and that was the expensive bug

Found by answering a question the author asked rather than by a test: *what
happens to `asia-2023` if a flight from Zurich is added first?*

Measured, both cases:

| frame | span | shapes clipped | path text |
| --- | --- | --- | --- |
| `asia-2023` as it is | 2,408 km | 525 | 1.2 MB |
| with a Zurich flight | 16,702 km | 7,448 | **13 MB** |

And the first row was not hypothetical. The live page was **754 KB gzipped**,
against a few tens of kilobytes before B46 — a regression this task introduced
and did not notice, because every check was about whether the map looked right
and none was about what it cost.

The cause is that `basemapFor` returned everything overlapping the frame at
1:10m, whatever the frame was. At sixteen thousand kilometres a whole island is
one pixel, and a 1.6 km coastline is detail being paid for and thrown away.

**Resolution now follows scale, in three bands** — the ordinary answer in
cartography, and one this task should have started from:

- under 900 km: 1:10m, with lakes, rivers, relief, glaciers, parks and admin-1;
- 900–6,000 km: 1:50m outlines only;
- above that: 1:110m outlines only.

Two bands were tried first and were not enough: `asia-2023` frames at 2,400 km,
where 110m is visibly blocky along the Vietnamese coast but 10m was still
shipping 1.2 MB, because at that resolution a single country polygon —
Indonesia, China — is tens of kilobytes by itself.

Result: the Asia map went from **754 KB to 128 KB** gzipped and still reads
correctly — coastline, borders, towns, peaks. A world-spanning frame is 138 KB.
The Alps, which is genuinely in the detailed band, is 316 KB.

The lesson worth keeping: this task measured the *source* data carefully at the
start and never measured what a reader downloads. Those are different numbers
and only one of them is the reader's problem.

### Checked, line by line

| Line | Evidence |
| --- | --- |
| ~10 km fixture framed on its stops | `test/world-map.test.tsx`, "a day inside one city" — four stops across ~6 km of Zurich, asserts the frame is under 60 km |
| Those stops as separate markers | same file, asserts four markers, one per stop |
| Continental trip unchanged | **see below — this line cannot be met as written** |
| One-stop trip is not a zero-width box | `test/map-frame.test.ts`, "a single stop gets a map rather than a point" |
| Close range is a deliberate choice, reasoned at the constant | `WAYS_BELOW_KM` in `lib/basemap.ts`, and the note where the rejected 30 km threshold used to be |
| Four checks | tsc clean, eslint 0 errors (4 pre-existing warnings), 1355 tests, build compiles |

**"A trip spanning continents frames exactly as it does today" cannot be
satisfied, and I have not rewritten it to something I could pass.** It
contradicts the Work section it sits under: padding as a fraction of the route,
a layout aspect, and a `cos(latitude)` correction all necessarily change the
frame of *every* map, including continental ones. A test pinning the old
viewBox would have to fail for the approved design to be built at all.

What is asserted instead, in `test/world-map.test.tsx` and
`test/map-page.test.tsx`: a continental route still has its whole span inside
the frame, still draws one marker per stop when they are far apart, still
clusters two stops in the same city, and Fukuoka-to-Sapporo still fits in a
frame between 1,400 and 5,000 km. That is the intent — long trips must not
regress — without pretending the numbers are unchanged.

**This is the author's call, not mine.** If "unchanged" was meant literally,
the aspect correction and the proportional padding are what would have to go.
