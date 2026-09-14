---
id: B1476
title: A trip marked upcoming says Where we have been, because one day names a place
type: ISSUE
priority: medium
complexity: low
area: map, trips
found: "2026-09-11T15:41:38Z"
started: "2026-09-13T07:02:32Z"
merged: "2026-09-13T07:05:31Z"
completed: "2026-09-14T16:31:42Z"
---

# B1476 — A trip marked upcoming says Where we have been, because one day names a place

## Why

Found by checking B1289 against the live instance, and it is B1289's own fault in
the opposite direction.

`https://fernscout.ch/example/trips/japan-2027/map` renders the heading
**"Where we've been"**. That trip's own file says:

```
start: "2027-03-28"
end:   "2027-05-09"
status: upcoming
```

Six months in the future, explicitly marked `upcoming`, and the page speaks about
it in the past tense. Two of its days carry a `location:`, and that is the whole
cause. The tense test is:

```
hasPlaces || (hasDays && isOver(trip, days))
```

`hasPlaces` comes first and short-circuits, so **one day naming a place is enough
to put a trip in the past tense regardless of its dates or its status.**

B1289 fixed the other direction — a finished trip saying "Where we're going" —
and left this half alone, correctly, because `hasPlaces` was the pre-existing
logic and widening a ticket mid-build is how scope gets lost. But the two halves
are one question: *has this trip happened?* — and that question currently
consults neither `start` nor `status`.

Writing a day ahead of a trip is an ordinary thing to do; a planned stop with a
location is what `plan.md` is for. So this is not just demo content being odd.

## Work

Decide the tense from whether the trip has happened, and let a place say *where*
rather than *when*. `isOver`, `status` and `start` are all available on that page;
`lib/tripTime.ts` holds the first.

Be careful of the case B1289 had to protect: B118's tested policy is that a trip
with **no days at all** stays in the planned tense past its own dates. Four tests
caught that when B1289 first missed it, so whatever replaces the condition must
keep it.

Check the subtitle and the metadata title too, which follow the same flag, and
`components/WorldMap.tsx`'s aria-label, which derives its own — see B1475.

## Acceptance

- A trip marked `upcoming`, with days that carry locations, reads in the future
  tense on its map page, its title and its aria-label.
- A finished trip still reads in the past tense, with or without coordinates.
- B118's empty-trip policy still holds, and a test says so.
- `npm run verify` clean.

## Revalidated — 2026-09-13

Still valid on current `main`: `MapPageContent` derives the heading from
`hasPlaces || (over && hasDays)`, so a future `upcoming` trip with a planned
day location is announced in the past tense. The page metadata already uses the
date-aware rule, while `WorldMap` independently derives its aria-label from
`places.length`, leaving the visible and accessible names inconsistent.

## Implemented

Map tense now depends only on a completed trip with at least one written day;
planned locations no longer force past tense. The same decision is passed to
`WorldMap` for its aria-label, keeping visible and accessible copy aligned. A
regression test covers a future trip with a located day and preserves the
finished-trip and empty-trip cases.

## Verification

- Map/page/world-map tests — 48 passed.
- `npm run build` — pass (existing 28 Turbopack filesystem warnings remain).
- `npx tsc --noEmit` — pass.
- ESLint — pass with no errors.
- `npm run unused` — pass (existing configuration hints only).
