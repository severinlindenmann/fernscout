---
id: B364
title: The lifetime map draws a bare coastline, dropping the borders, lakes and rivers its own basemap already carries
type: FEATURE
priority: medium
complexity: low
area: maps, trips
found: "2026-09-04T20:45:00Z"
started: "2026-09-04T20:42:43Z"
session: e8e2ddef-3ce3-473a-9308-388259ef4452
claimed: "2026-09-04T20:42:43Z"
---

# B364 — The lifetime map draws a bare coastline, dropping the borders, lakes and rivers its own basemap already carries

## Why

Asked by the owner on 2026-09-04, looking at the country fill B361 shipped:
more detail on the map, and a name on the countries they have been to as long
as it does not become crowded.

Three quarters of this is not new data — it is data already on the page and
thrown away. `app/[user]/trips/page.tsx:281` already computes
`basemapFor(frameRoute(...))` and passes it, and `Basemap` (`lib/basemap.ts:69`)
carries `borders`, `lakes`, `rivers`, `admin1`, `relief` and more. B361's fill
branch ignores all of it and draws `worldLand` — a coastline with no internal
borders, no water and no country lines — because that was the quickest ground
to put the fills on. The non-fill branch beside it has drawn `basemap.borders`
and `basemap.lakes` all along, so the two halves of one component disagree
about how much map a map has.

Labels are the part that needs something new: `lib/worldCountries.json` carries
a code, a name and an outline, but no position to put a name at.

## Work

1. **Use the basemap in the fill branch**, the way the branch beside it
   already does: `borders` for country lines, `lakes` and `rivers` for water.
   Keep `worldLand` as the fallback for when no basemap has been built — a map
   with no borders beats a page that will not render, which is
   `lib/basemap.ts`'s own rule.
2. **Draw order matters.** Ground, then borders, then the visited fills, then
   water and rivers over the top — a river that vanishes under a filled
   country looks like a rendering bug, and a border drawn over a fill is what
   makes the fill read as *that country* rather than as a coloured blob.
3. **Label the visited countries, and only them.** Unvisited countries are
   scenery; naming all 177 is the wall of text `lib/basemap.ts` already refuses
   for towns. Needs a position per country in `lib/worldCountries.json` —
   add it in `scripts/build-world-countries.mts` rather than computing it in
   the browser, since the shapes are already being walked there.
4. **The crowding guard is the point of the request, not a refinement.**
   "As long as it is not crazy crowded" — so a label needs a rule for when it
   is dropped: how much room the country has on screen, how many labels the
   frame already holds. `MAX_TOWN_LABELS` in `lib/basemap.ts` is the existing
   answer to this exact question and should be read before inventing another.
   A dropped label must not drop the fill — the country is still visited.
5. Check what this does to a journal framed tightly (one country) as well as a
   world-scale one. The frame drives everything here and B46 is still open on
   how a one-city journal frames.

Not in scope: `admin1`, `relief`, `roads` and `railroads` — the basemap
suppresses most of them above a few thousand kilometres anyway, and a lifetime
map is the widest frame on the site. Not the per-trip `WorldMap`, which is
already detailed. Not B46.

## Acceptance

- The demo journal's lifetime map shows country borders, lakes and rivers, and
  the six visited countries stay legible as fills over them.
- Visited countries are named; unvisited ones are not.
- A frame where labels would collide drops some rather than overlapping them,
  and never drops a fill.
- A journal with no basemap built still renders (coastline, fills, no water).
- `npm run verify`.
