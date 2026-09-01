---
id: B54
title: An upcoming trip's map is titled "Where we've been"
type: ISSUE
priority: low
complexity: low
area: map, i18n, plan
found: "2026-09-01"
started: "2026-09-01"
---

# B54 — An upcoming trip's map is titled "Where we've been"

## Why

Found while building B18. That task made `/example/trips/japan-2027/map` draw
the planned route it had been withholding; what is now visible above the map is
copy written for a trip that has already happened.

```
Wo wir waren
Tippe auf einen Ort, um zu sehen, wie lange wir dort waren.
```

`map.title` and `map.subtitle` (`content/locales/de.json:266–267`, and the
same pair in `en.json` and `hu.json`) are both past tense — "Where we've been",
"Tap any stop to see how long we stayed and what we shot there". On a trip
starting in March 2027 with no entries, both sentences are false, and the
second describes an interaction that does nothing: there are no stops to tap,
only planned ones, and tapping a planned marker opens nothing.

B18 handled the three things that were structurally wrong on that page — the
missing map, the row of zeroes, the empty list of stops. This is the fourth and
it is a different kind: not a component deciding what to render, but one string
that is right for two of the three trip statuses.

It is `low` because it is cosmetic and the page is now otherwise correct, and
`low` complexity because the mechanism is already in the file — `MapPageContent`
knows whether it has places, which is the same question the rest of the page now
asks (`hasPlaces`).

## Work

Two strings that vary by whether the trip has happened. Something like
`map.title.planned` / `map.subtitle.planned`, chosen on `hasPlaces` rather than
on `trip.status` — the component does not receive the status, and B18
deliberately kept the decision on what the page actually has rather than on what
the trip claims to be.

The trip index already carries copy in the right register for this
(`trips.noEntriesYet`, "No days written yet — this one hasn't happened") and is
worth matching.

Three locale files plus the key union in `lib/i18n.ts`; `npm run i18n:keys`
regenerates the union.

Worth checking whether the same tense problem exists on the other pages an
upcoming trip can reach — the gallery and the costs page. B19 already covers the
costs page reporting spending that has not happened, which is the same defect
one level deeper.

## Acceptance

- `/example/trips/japan-2027/map` is titled and subtitled for a trip that has
  not started, and neither sentence claims anybody has been anywhere.
- A trip with entries is unchanged.
- `npm run i18n:keys` passes, and so do `npx tsc --noEmit`, `npx eslint .`,
  `npx vitest run` and `npm run build`.
