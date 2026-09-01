---
id: B46
title: A trip that stays inside one city draws as a single dot on a map thousands of kilometres wide
type: ISSUE
priority: medium
complexity: medium
area: map, ui
found: "2026-09-01"
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

## Work

The framing arithmetic is straightforward; the basemap is a decision and should
be made before the rest is built, because it determines whether zooming in is
worth offering at all.

**Decide what a close-up map shows.** Three honest options, and the second is
the recommendation:

- Ship a higher-resolution basemap (`land-50m`, or `10m` for coastal detail).
  Correct-looking, and it grows a payload that is currently baked and free.
  50m still has little to say inside a city.
- **Stop pretending there is terrain.** Below some span, drop the coastline and
  draw the route and its stops on the clean background the brand already uses —
  an abstract diagram of the trip rather than a bad map of a city. This is
  honest at every scale, needs no new data, and for a walk across a city is
  arguably the better picture.
- Fetch raster tiles. Rejected unless the author says otherwise: it makes every
  reader's browser call a third party that then learns their IP and which trip
  they opened, on a self-hosted journal whose maps are deliberately baked in.

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

**Not doing:** an interactive slippy map, tile fetching (see above), per-day
GPS traces (B06), or changing what counts as a place.

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
