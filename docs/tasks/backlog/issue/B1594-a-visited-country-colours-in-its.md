---
id: B1594
title: A visited country colours in its overseas territories, so the map claims places nobody went
type: ISSUE
priority: medium
complexity: medium
area: maps, countries
found: "2026-09-12T15:48:49Z"
---

# B1594 — A visited country colours in its overseas territories, so the map claims places nobody went

## Why

Reported by Severin, 2026-09-12, about the lifetime map on
`https://fernscout.ch/severin/trips`: a trip to France colours in a shape in
South America he has never been to.

He is right, and it is one shape rather than a class of them. The country
outlines are baked by `scripts/build-world-countries.mts` from Natural Earth
1:110m (`world-atlas/countries-110m.json`), **one SVG path per ISO 3166-1
alpha-2 code**, and Natural Earth's admin-0 features are *sovereign states*:
France (id 250) is a single MultiPolygon of three parts spanning longitude
−55 to 10. The third part is French Guiana. `app/[user]/trips/page.tsx:291`
looks the country up by code and fills the whole path, so there is no seam at
which the map could distinguish the part somebody stood in.

Measured against the actual 110m data — every MultiPolygon whose parts sit
more than 15° from the largest part:

- **France → French Guiana** (−53, 4). The only one that is plainly wrong.
- **Norway → Svalbard** (22, 80). Arguable; a judgement, not a bug.
- Everything else that trips the same test is domestic and correct: Canada's
  Arctic islands, Hawaii and Alaska, Tasmania, Hainan, Tierra del Fuego,
  Russia's north, Fiji.

The build script already knows about this one: `build-world-countries.mts:99`
forces the label onto the largest landmass so that the word "France" does not
land in South America. The fill had no such correction.

The Caribbean départements he also names — Guadeloupe, Martinique, Réunion,
Mayotte — are **below the 110m resolution and are not drawn at all**, so they
are not part of the visible fault today. They are a quieter fault of their own:
a day tagged `country: Réunion` resolves cleanly to `RE`, finds no shape, and
is dropped at `app/[user]/trips/page.tsx:291-308`. So a real visit colours
nothing while an imagined one colours a continent — the same seam, cut both
ways, which is the reason to fix this at the build script rather than at the
fill.

Worth knowing before touching it: a country comes from a day's `country:`
frontmatter string, never from its coordinates (`lib/entries.ts:297`,
`lib/flags.ts:45`). Nothing infers a country from where a day was.

There is a second symptom from the same path, and it is the more visible one:
`countryCorners` (`app/[user]/trips/page.tsx:363`) takes the **bounding box of
the whole path** to work out the frame the basemap is clipped to. A locked
French trip therefore drags the map's frame across the Atlantic to −55°,
zooming a European journal out to fit an empty ocean.

## Work

Fix it where the shapes are baked, not where they are filled — the fill has no
information to work with, and one build-time table beats a special case in two
consumers.

In `scripts/build-world-countries.mts`, split a feature's far-flung parts off
from the parent and emit them under **their own ISO 3166-1 code**, from a small
hand table beside the existing `ALIASES` (`GF` for the South American part of
`FR`, and a decision on `SJ` for Svalbard). At 110m that table has one
certain row and one debatable one, which is the whole size of it.

Then the existing lookup works unchanged: a journal that visited France gets
`FR` and not `GF`, and a journal that actually went to Cayenne gets `GF`
because that is the country its day names. Both the fill and the frame follow
for free.

Not in scope: raising the baked resolution, and any handling of territories
110m does not draw.

## Acceptance

- A trip whose only country is France colours metropolitan France and leaves
  South America unfilled.
- The same journal's map frame does not extend past the Atlantic — the
  bounding box no longer reaches −55°.
- A test over `lib/worldCountries.json` asserts that no country's path spans
  more than a plausible longitude range for its mainland — or, more simply,
  that `FR`'s path stays east of −10°.
- A day in French Guiana still colours something.
- The component under this is `components/LifetimeMap.tsx` (fill at :185); check
  it in a browser on an existing journal, not only in a test — the fill is only
  drawn when `visits.length > 0`.
