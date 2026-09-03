---
id: B85
title: An upcoming trip with no plan serialises a whole-world basemap into a page that draws no map
type: ISSUE
priority: medium
complexity: low
area: trips, maps, payload
found: "2026-09-01"
started: "2026-09-03T19:23:10Z"
session: a4b53c2f-00e4-4e62-bc65-91f1f227b1e1
claimed: "2026-09-03T19:23:10Z"
---

# B85 — An upcoming trip with no plan serialises a whole-world basemap into a page that draws no map

## Why

`app/[user]/trips/[trip]/page.tsx` built the countdown's basemap before knowing
whether there was anything to frame:

```ts
basemap={basemapFor(frameRoute(plan.stops))}
```

`frameRoute([])` returns `WHOLE_WORLD` (`lib/mapFrame.ts:146–147`), which is
deliberate and documented — "empty input frames the whole world, which is what
a trip with no located days or stops gets". `basemapFor` then clips the bundle
to that frame, which clips nothing, and the result is serialised into the RSC
payload.

`TripCountdown` renders `WorldMap` only when `stops.length > 0`
(`components/TripCountdown.tsx:83`). So on a trip with no `plan.md` the payload
carried a basemap to a page that never draws a map at all.

Who hits it: anybody who starts a trip before planning its route — which is the
ordinary way to start one, and `add-a-trip` treats `plan.md` as optional. On a
phone on mobile data, that is the first page they are shown.

**The 17.5 MB in the original capture is stale, and this is the correction.**
That figure was measured on 2026-09-01, before commit `135db68` landed the
three-band clip later the same evening (`DETAIL_BELOW_KM`, `MID_BELOW_KM`,
`bordersCoarse` in `lib/basemap.ts`). A whole-world frame is 40,075 km across,
so it now falls to 1:110m country outlines and drops lakes, rivers, relief,
ice, roads and railways entirely. Measured again on this branch, before the
fix: **159,317 bytes** of basemap JSON — 286 border paths, 22 town labels and
8 peak labels. Still a payload nobody can see, but two orders of magnitude
smaller than the task claimed, so the priority is right and the alarm was not.

Nothing else in the Why changed. B72 narrowed the entrance without closing it:
the countdown now also requires that no day has been published (`showsCountdown`,
`lib/tripView.ts`), so a mis-statused trip no longer reaches this. A genuinely
upcoming trip with no planned route still did, and that is the case this fixes.

## Work

Done. The bug is the *distance* between two conditions — every component is
already guarded on having something to draw, and every server call site built
the basemap before asking — so the fix puts the pair in one place rather than
repeating a ternary five times:

```ts
// lib/basemap.ts
export function basemapForRoute(points: readonly Point[]): Basemap | null {
  return points.length > 0 ? basemapFor(frameRoute(points)) : null;
}
```

`frameRoute` is unchanged: returning `WHOLE_WORLD` for empty input is correct,
and the caller is what must not ask.

Every call site was then checked against whether its consumer actually renders,
and **four of the five were wrong in the same way**, not one:

| Call site | Consumer, and what it is guarded on | Now |
| --- | --- | --- |
| `app/[user]/trips/[trip]/page.tsx` | `TripCountdown` — `stops.length > 0` | `basemapForRoute(plan.stops)` |
| `app/[user]/(trip)/map/page.tsx` | `MapPageContent` — `hasPlaces \|\| plan.length > 0` | `basemapForRoute(places.length > 0 ? places : plan.stops)` |
| `app/[user]/trips/[trip]/map/page.tsx` | same | same |
| `lib/tripView.ts` | `TripStory` returns the empty state at `index.length === 0`, so no hero and no `MiniMap` | `basemapForRoute(index)` |
| `app/[user]/trips/page.tsx` | `TripsIndexContent` — `mapRoutes.length > 0` | guarded on `routes.length > 0`, **not** on the points |

The last one is deliberately not the helper. `LifetimeMap` frames
`routes.flatMap(r => r.points)`, so a journal of trips that were never
geotagged has routes but no points and still draws a world map — which needs
its basemap. Guarding that site on the points would have removed data the page
does draw. The condition used is the component's own.

The two map pages and `lib/tripView.ts` were not in the original Work section
and are the same bug: a current trip with no located days and no plan, and a
trip whose every day is still a draft as a stranger sees it, both reached the
empty state carrying 159 KB.

Not done, deliberately: whether a whole-world basemap should be 159 KB at all,
and whether the 519 KB an Alpine frame ships is right. Both are about a payload
somebody can see, which is a different question from this one.

## Acceptance

- The trip page for an upcoming trip with no `plan.md` carries no basemap in
  its payload, and the response is within an order of magnitude of the same
  journal's story page rather than three.
- An upcoming trip *with* a planned route still draws its map, framed as before.
- A test asserting the basemap prop is null when there are no stops.

**Line 1 — measured as a response.** `next dev` on a copy of `content/` with
`japan-2027/plan.md` removed (it is `upcoming`, and both its entries are
drafts, so it draws the countdown), `curl … | wc -c`:

| `GET /example/trips/japan-2027` | bytes |
| --- | --- |
| before the fix | 226,079 |
| after | 65,687 |
| difference | 160,392 — the 159,317-byte basemap, plus RSC escaping |
| `Natural Earth` (the basemap's attribution) in the response | 1 before, **0** after |

Same journal's story pages, for the comparison the line asks for:
`/example/trips/parks-2025` is 475,698 bytes and `/example/trips/alps-2024`
is 1,091,637. The countdown is now a seventh of the smaller one.

The "rather than three [orders of magnitude]" half of that line **cannot be
demonstrated and is no longer true**: it was written against the stale 17.5 MB
figure. Since `135db68` the gap was 226 KB against 476 KB — the countdown was
already *smaller* than a story page, just carrying 159 KB nobody could see.
The line is left as filed rather than rewritten to fit the result.

**Line 2 — the map still draws, framed as before.** With `plan.md` restored,
the countdown's map renders at `viewBox="652.79 120.36 77.91 48.69"` — Japan,
not `0 0 1000 500` — and carries its attribution. Every other route that draws
a map still does, with its basemap: `/example/map`, `/example/trips/*/map`, and
`/example/trips`, whose lifetime map genuinely frames the whole world (Asia and
the USA in one view) and therefore genuinely keeps the whole-world basemap.

**Line 3 — the test.** `test/basemap-payload.test.tsx`, five assertions, which
measure the countdown's markup plus the props React serialises alongside it:

| | bytes |
| --- | --- |
| countdown, no plan, before | 166,669 |
| countdown, no plan, after | 7,352 |
| of which the whole-world basemap was | 159,317 |
| countdown with a plan, after (map drawn) | 1,057,047 |

It fails on the pre-fix behaviour — reverting `basemapForRoute` to build
unconditionally fails two of the five — and asserts both halves: the prop is
null with no stops, and with stops it is deep-equal to
`basemapFor(frameRoute(stops))`, so the map is framed exactly as before.
