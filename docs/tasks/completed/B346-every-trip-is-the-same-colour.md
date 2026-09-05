---
id: B346
title: Every trip is the same colour because the scaffold writes accent sky and nothing assigns a distinct one
type: FEATURE
priority: medium
complexity: low
area: trips, maps
found: "2026-09-04T19:52:00Z"
started: "2026-09-04T19:56:10Z"
merged: "2026-09-04T20:02:52Z"
completed: "2026-09-05T08:37:07Z"
---

# B346 — Every trip is the same colour because the scaffold writes `accent: sky` and nothing assigns a distinct one

## Why

Asked by the owner on 2026-09-04, immediately after B344 removed the route
lines from the lifetime map. That change makes this urgent rather than
cosmetic: with no lines, **colour is the only thing distinguishing one trip's
pins from another's** on `/<user>/trips`, and today every trip is the same blue.

Two halves, and the second is why the obvious fix does not work.

**Nothing assigns a distinct colour.** `components/LifetimeMap.tsx:133` and
`:184`, and `app/[user]/trips/TripsIndexContent.tsx:383`, all read
`ACCENT_HEX[trip.accent]` straight from the trip. Whatever the trips happen to
say is what the reader gets, including all of them saying the same thing.

**And "what the trip says" is not a choice anybody made.**
`lib/tripWrite.ts:497,588` writes an accent into every scaffolded `trip.md`:

```ts
const accent = ACCENTS.includes(input.accent as never) ? input.accent! : "sky";
…
`accent: ${accent}`,
```

`lib/trips.ts:203-206` then defaults a *missing* one to `"sky"` as well. So a
trip nobody coloured and a trip deliberately set to sky are byte-identical on
disk, and no code can honour an explicit choice without also honouring a
default that was never chosen. Every journal whose trips were created through
the API is uniformly sky.

## Work

Decided with the owner, 2026-09-04 — honour a real choice, assign one otherwise:

1. **Stop writing the default.** `lib/tripWrite.ts` writes `accent:` only when
   the caller actually named one. Absence then honestly means "no preference",
   which is what the rest of this depends on.
2. **Make absence representable.** `parseAccent` (`lib/trips.ts:203`) returns
   `undefined` for a missing or unrecognised value rather than `"sky"`, and
   `Trip.accent` (`lib/types.ts:297`) becomes optional. Every consumer that
   needs a concrete colour falls back at the point of use — there are few:
   `app/[user]/trips/page.tsx:182,196`, `TripsIndexContent.tsx:151,383`,
   `LifetimeMap.tsx:133,184`, `scripts/build-demo-content.mjs:1124`.
   An unrecognised value must keep reading as "no preference", never as a
   throw — a typo in a colour is not worth a broken page.
3. **Assign by position where there is no preference**, on the trips page, so
   the map pins, the map legend and the trip cards all agree. Walk the trips in
   order, skip colours already claimed by a trip that *did* choose, and cycle
   the palette when it runs out.
4. **Existing files are not migrated.** Every `trip.md` written before this
   still says `accent: sky` and will keep reading as a deliberate sky. Say so
   in the response rather than silently rewriting somebody's content; stripping
   the line from a trip the owner never coloured is their call, one file at a
   time.

Not in scope: widening the palette beyond the five accents (a journal with more
than five uncoloured trips repeats, which the owner accepted); B344, already
merged; the `accent` used on a trip's own pages and in the photobook, which is
correct as it stands.

## Acceptance

- A journal with three trips, none naming an accent, renders three different
  colours on `/<user>/trips` — pins, legend and cards agreeing per trip.
- A trip that names `accent: coral` is coral, and no auto-assigned trip takes
  coral while it is claimed.
- A trip created through `POST /api/v1/<user>/trips` with no accent produces a
  `trip.md` with **no** `accent:` line; one created with `accent: green` keeps it.
- A journal with six uncoloured trips draws six pins and repeats a colour
  rather than crashing or drawing an undefined fill.
- A trip.md with `accent: banana` renders as no-preference, not an error.
- `npm run verify`.
