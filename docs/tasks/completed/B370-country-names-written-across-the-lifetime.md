---
id: B370
title: Country names written across the lifetime map are unreadable, and one hue for every country makes the map say little
type: FEATURE
priority: medium
complexity: medium
area: maps, trips
found: "2026-09-04T21:20:00Z"
started: "2026-09-04T21:06:53Z"
merged: "2026-09-04T21:12:54Z"
completed: "2026-09-05T08:37:06Z"
---

# B370 — Country names written across the lifetime map are unreadable, and one hue for every country makes the map say little

## Why

Reported by the owner on 2026-09-04 with a screenshot of the local demo (23
countries, 7 trips), immediately after B364 added the labels.

**The labels do not work and are not worth tuning.** "United States of America"
is written across the Pacific in letters wider than the country; "France" sits
over the Bay of Biscay next to an Italy it does not name; "Japan" floats in the
sea to the east. The label is placed at the centre of a bounding box, which is
in the sea for any country that is not a compact blob, and Natural Earth's names
are long where a reader wants "United States". On top of that only 5 of 23
countries were named at all, because `spread`'s 22%-of-frame separation — tuned
for towns on a tight map — is far too coarse across a whole world. Fixing the
placement, the names and the density is three fixes for a thing that should not
be on the map at all: **a legend beside the map does this job properly**, and
`lib/flags.ts` already has `flagFor()` to make it read well.

**And every country being the same hue makes a dull map.** B361 chose one hue
deepened by visit count, which is correct as data encoding and, at 23 countries,
renders as a uniform pink wash where only two countries differ.

## What was decided, and by whom

The owner chose this on 2026-09-04, and it **reverses the colour half of
B361** — do not revert it back without asking:

- **A country is filled in its own flag's colour.** The map becomes varied and
  personal; a reader recognises Japan and Italy without reading anything.
- **Visit count moves off the map and into the legend** — `🇮🇹 Italy ×3` —
  which is where a count is actually read. It stops being a colour channel.
- The owner accepted the known cost, stated before they chose: **many flags
  collide.** France, the Netherlands, Czechia, Norway, Slovakia, the UK and the
  USA are all red-white-blue, and much of Africa is green-yellow-red. Adjacent
  countries will look similar and no amount of care fully fixes it.

## Work

1. **Delete the on-map `<text>` labels** added by B364, and the label
   plumbing that fed them: `MAX_COUNTRY_LABELS` and the `spread()` call in
   `app/[user]/trips/page.tsx`, the `labels` prop through `TripsIndexContent`
   into `LifetimeMap`. Leave `spread` exported and used by the basemap's own
   town and peak labels, which are fine.
   The `x`/`y`/`w` fields baked into `lib/worldCountries.json` become unused —
   decide whether to keep them (cheap, and a future label attempt needs them)
   or drop them from `scripts/build-world-countries.mts` and rebuild.
2. **A flag colour per country**, keyed by ISO alpha-2. It is data, so it goes
   in its own module rather than in the component.
3. **Handle the collisions rather than shipping them.** Carry a *second*
   colour from each flag and assign greedily: a country takes its primary
   unless another visited country already has it, then its secondary. That
   turns the red-white-blue pile-up into a mix instead of five identical
   shapes. Deterministic — the same journal must colour the same way on every
   render, so order the assignment by something stable, not by iteration order
   of a map.
4. **A legend of the countries visited**, beside or below the map: flag emoji,
   country name, and the visit count where it is more than one. Use the name
   from the journal's own content (`Place.country`), not Natural Earth's — the
   content says "United States" where the shapefile says "United States of
   America".
5. Keep the legend as the accessible equivalent: the map's colours carry no
   meaning a reader can get any other way, so the legend must list every
   visited country, not only the ones that fitted.
6. The pin fallback for a journal with no country data (B361) is untouched, and
   so is its trip-colour legend.

Not in scope: the per-trip `WorldMap`; B46; the `#c2334a` clash between the old
3+ fill and the `coral` trip accent, which this removes anyway.

## Acceptance

- No `<text>` country names are drawn on the lifetime map.
- Every visited country appears in the legend with its flag and name, and a
  count when visited more than once.
- Two countries whose flags share a dominant colour are not filled identically.
- The same journal renders the same colours twice in a row.
- A journal with no country data still draws pins and its trip legend.
- `npm run verify`.
