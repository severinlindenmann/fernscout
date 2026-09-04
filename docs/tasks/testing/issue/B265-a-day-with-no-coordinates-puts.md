---
id: B265
title: A day with no coordinates puts NaN through every map on the site
type: ISSUE
priority: high
complexity: low
area: maps, entries
found: "2026-09-04T11:35:50Z"
started: "2026-09-04T11:36:57Z"
merged: "2026-09-04T11:52:04Z"
---

# B265 — A day with no coordinates puts NaN through every map on the site

## Why

Reported 2026-09-04 with a browser console from `https://fernscout.ch/viki`:

```
Error: <svg> attribute viewBox: Expected number, "NaN NaN NaN NaN".
Error: <rect> attribute x: Expected length, "NaN".
Error: <g> attribute transform: Expected number, "scale(NaN 1)".
Error: <polyline> attribute points: Expected number, "NaN,NaN NaN,NaN …".
Error: <circle> attribute cx: Expected length, "NaN".
```

repeated for every element on the map, hundreds of lines of it. The map draws
nothing.

`lib/entries.ts:294-306` — `getPlaces` pushes a `Place` for **every** day it
finds and copies `lat: lead.lat, lng: lead.lng` with no check that either
exists. `lat` and `lng` are optional on an entry (`createDraft` writes them
only when given — `lib/api/entries.ts:274-275`), so a day written without
coordinates yields a place whose `lat` is `undefined`.

That place reaches the maps as a point. `app/[user]/trips/page.tsx:112-114`
maps places straight to `{lat, lng, location}`, and `frameRoute`
(`lib/mapFrame.ts:163-165`) then computes

```
midLat  = (Math.min(...lats) + Math.max(...lats)) / 2   // NaN
lngScale = Math.max(0.2, Math.cos(midLat * Math.PI / 180))  // NaN
```

`Math.max(0.2, NaN)` is `NaN`, not `0.2`, so the frame's every field is `NaN`
and all three maps — `LifetimeMap`, `WorldMap`, `MiniMap` — render `NaN` into
every attribute they own.

`frameRoute` handles the *empty* case (`points.length === 0` → `WHOLE_WORLD`,
line 155). It is the half-populated case nobody guarded: a journal where some
or all days have no coordinates, which is every journal written by an agent
that was never asked for them (B267).

## Work

Root cause, one guard, where all three maps route through — not three
component-level patches.

- **Filter non-finite points in `frameRoute`.** A point whose `lat` or `lng` is
  not a finite number is not a point; drop it, and if nothing survives return
  `WHOLE_WORLD` the way the empty case already does. `Number.isFinite` on both,
  which also catches a hand-written `lat: "north"` parsed out of frontmatter.
- **Do not emit coordinate-less places as points** where the point lists are
  built, so a polyline is not drawn through a gap it cannot know about. Check
  every caller of `getPlaces` that builds points — `app/[user]/trips/page.tsx`
  is the one in evidence, and there are others; find them all rather than the
  one in the report.
- **Leave `getPlaces` returning them.** A day with no coordinates is still a
  place with entries, nights and a media count, and the place list, the day
  list and the totals are all correct today. Narrowing `getPlaces` to
  coordinate-bearing days would silently drop days from the totals, which is a
  worse bug than this one.
- Consider whether a map with no plottable point should render at all, or say
  it has nothing to draw. B85 is the same question for an upcoming trip with no
  plan and is still open; do not solve it here, but do not fight it either.

## Acceptance

- A trip whose days have no coordinates renders `/<user>`, `/<user>/trips` and
  the trip page with **no** console error and no `NaN` in the served HTML.
- A trip where only some days have coordinates draws a route through those
  days and does not reach for the others.
- Unit tests on `frameRoute`: a point with `lat: undefined`, one with a
  non-numeric `lat`, and an all-invalid list returning `WHOLE_WORLD`.
- `curl -s https://<host>/<user> | grep -c NaN` is `0`.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
