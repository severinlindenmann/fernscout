---
id: B339
title: getPlaces merges every unnamed day into one place, collapsing a whole trip's coordinates to a single point
type: ISSUE
priority: high
complexity: low
area: maps, entries
found: "2026-09-04T19:30:00Z"
started: "2026-09-04T19:29:30Z"
merged: "2026-09-04T19:37:20Z"
---

# B339 — `getPlaces` merges every unnamed day into one place, collapsing a whole trip's coordinates to a single point

## Why

Reported 2026-09-04: `fernscout.ch/viki/map` draws one dot and
`fernscout.ch/viki/trips` one pin, while `fernscout.ch/viki` draws the whole
route. Read with an owner token, `GET /api/v1/viki/trips/asien-2025/days`
returns fifteen days that **all carry valid, distinct coordinates** —

```
2025-11-01 zurich-nach-bangkok   location='' lat=13.7563 lng=100.5018
2025-11-05 chiang-mai            location='' lat=18.7883 lng=98.9853
2025-11-13 hanoi                 location='' lat=21.0285 lng=105.8542
2025-11-15 zuhause               location='' lat=47.3769 lng=8.5472
```

— and `location: ""`, `country: ""` on every one. Zero drafts.

`lib/entries.ts:350`:

```ts
if (last && last.location === lead.location && last.country === lead.country) {
  last.entries.push(...day.entries);   // merged into the previous place
```

`"" === ""` holds, so **every** consecutive pair matches and all fifteen days
collapse into a single `Place` — which keeps the *first* day's coordinates and
discards the rest. Bangkok and Hanoi, seven degrees of latitude apart, are
treated as the same place on the evidence that neither is named.

An empty `location` means *unknown*, not *the same as yesterday*. The
comparison reads the absence of a name as a matching name.

This is why the three surfaces disagree, and the disagreement is a symptom
rather than the bug: `MiniMap` on `/<user>` plots `index` per day and never
calls `getPlaces` (`app/TripStory.tsx:502`), so it shows the true fifteen-point
route. `WorldMap` (`/<user>/map`) and `LifetimeMap` (`/<user>/trips`) both go
through `getPlaces` and get one point — and `LifetimeMap` only draws a
`<polyline>` at `pts.length > 1`, so the route line vanishes too.

`location:` is optional in an entry's frontmatter and always has been, so this
is reachable by any journal whose days were written without place names — which
is what an agent produces unless asked (B267). It is not the coordinate problem
of B265/B267: the coordinates are present and correct, and the code throws
fourteen of them away.

## Work

- **Do not merge on an empty name.** In `getPlaces`, require a non-empty
  `location` before the consecutive-day merge — an unnamed day starts its own
  place. Smallest correct change; check `country` the same way rather than only
  `location`, since either being blank makes the pair meaningless.
- Consider whether coordinates should participate in the comparison at all: two
  consecutive days both named "Bangkok" but 200km apart currently merge to the
  first day's position. Out of scope unless it falls out of the fix for free —
  capture it separately if it does not.
- `key: \`${lead.location}-${day.date}\`` (line 357) is already date-qualified,
  so unnamed places will not collide as React keys. Confirm rather than assume.
- Check what the map renders for a place with no name once they stop merging:
  fifteen unlabelled pins is better than one wrong pin, but the marker label and
  the `SlideShow` caption should not read as an empty string. `flagFor(country)`
  with `country: ""` is on that path too.
- Not in scope: B336 (the surfaces disagree about drafts), B337 (the blank
  gallery chip — same empty `location`, already merged).

## Acceptance

- A trip whose days have coordinates but no `location:` plots **one marker per
  distinct position** on `/<user>/map` and `/<user>/trips`, and `/trips` draws a
  route line through them.
- The same trip plots the same number of markers on all three surfaces.
- A trip whose consecutive days share a real `location:` still merges them —
  the existing behaviour is correct and must not regress.
- A `getPlaces` unit test with three days, all `location: ""`, distinct
  coordinates, asserting three places. It fails today, returning one.
- `npm run verify`.
