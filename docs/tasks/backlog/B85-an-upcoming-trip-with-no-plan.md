---
id: B85
title: An upcoming trip with no plan serialises a whole-world basemap into a page that draws no map
type: ISSUE
priority: medium
complexity: low
area: trips, maps, payload
found: "2026-09-01"
---

# B85 — An upcoming trip with no plan serialises a whole-world basemap into a page that draws no map

## Why

Found on 2026-09-01 while building **B72**, and measured rather than inferred:
the response for one such trip was **17.5 MB**, against 78 KB for the same
trip's story page.

`app/[user]/trips/[trip]/page.tsx` builds the countdown's basemap before
knowing whether there is anything to frame:

```ts
basemap={basemapFor(frameRoute(plan.stops))}
```

`frameRoute([])` returns `WHOLE_WORLD` (`lib/mapFrame.ts:146–147`), which is
deliberate and documented — "empty input frames the whole world, which is what
a trip with no located days or stops gets". `basemapFor` then clips the world
land geometry to that frame, which clips nothing, and the entire dataset is
serialised into the RSC payload.

`TripCountdown` renders `WorldMap` only when `stops.length > 0`
(`components/TripCountdown.tsx:83`). So on a trip with no `plan.md` the payload
carries a complete world basemap to a page that never draws a map at all.

Who hits it: anybody who starts a trip before planning its route — which is the
ordinary way to start one, and `add-a-trip` treats `plan.md` as optional. On a
phone on mobile data, that is the first page they are shown.

B72 narrowed the entrance without closing it. The countdown now also requires
that no day has been published (`showsCountdown`, `lib/tripView.ts:59–61`), so
a mis-statused trip no longer reaches this. A genuinely upcoming trip with no
planned route still does, and that is the case the task is about.

## Work

Guard the basemap on the same condition the map itself is guarded on:
`plan.stops.length > 0 ? basemapFor(frameRoute(plan.stops)) : null`.
`TripCountdown` already accepts `basemap = null` (`components/TripCountdown.tsx:17`),
so nothing downstream changes.

Then look for the same pair elsewhere, because the bug is the *distance*
between the two conditions rather than this one call site: `basemapFor` is
called in `lib/tripView.ts:174` and in the map and trip-list pages, and each is
worth checking against whether its consumer actually renders. `frameRoute`
returning `WHOLE_WORLD` for empty input is correct and should not change — the
caller is what must not ask.

Worth measuring while there whether a whole-world basemap should be that large
at all, but do not fold that in; a payload nobody needs is the finding here.

## Acceptance

- The trip page for an upcoming trip with no `plan.md` carries no basemap in
  its payload, and the response is within an order of magnitude of the same
  journal's story page rather than three.
- An upcoming trip *with* a planned route still draws its map, framed as before.
- A test asserting the basemap prop is null when there are no stops.
