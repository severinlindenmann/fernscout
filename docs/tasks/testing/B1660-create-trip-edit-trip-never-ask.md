---
id: B1660
title: create_trip/edit_trip never ask v2's TRIP_DECLINABLES (rates, costs, plan, translations, accent, figures, tagline, intro)
type: FEATURE
priority: medium
complexity: high
area: Helper / API v2
found: "2026-09-13T10:36:37Z"
merged: "2026-09-13T14:28:09Z"
---

# B1660 — create_trip/edit_trip never ask v2's TRIP_DECLINABLES (rates, costs, plan, translations, accent, figures, tagline, intro)

## Why

B1650 (decision a) taught the helper's day tools to ask about the fields v2's
`dayWrite` schema requires-or-declines (`DAY_DECLINABLES`,
`lib/api/v2/schemas/day.ts`) rather than letting them go silently unanswered
forever. `lib/helper/tools/areas/trips.ts`'s `create_trip` and `edit_trip`
have the identical gap on the trip side: `TRIP_DECLINABLES`
(`lib/api/v2/schemas/trip.ts`) lists nine required-or-declined sections —
`rates`, `costs`, `plan`, `translations`, `accent`, `figures`, `tagline`,
`intro`, plus `listed`/`teaser` depending on visibility — and `create_trip`'s
own `propose()` (`lib/helper/tools/areas/trips.ts` around line 80) only ever
asks for `title`/`start`/`end`/`visibility`. Every trip the wizard creates is
missing nine answers the v2 contract says a trip owes, with no path to
answer them short of an agent driving `/api/v2/…` directly.

## Work

Same shape as B1650's day-side build, not a repeat of its design discussion:

- Read `lib/api/v2/schemas/trip.ts`'s `TRIP_DECLINABLES` and decide which of
  the nine map cleanly onto `create_trip`/`edit_trip` as real tool arguments
  (a value or a decline), which need their own dedicated tool (e.g. `figures`
  already has one — `lib/helper/tools/areas/trips.ts`'s figure-related
  entries, check before assuming there is a gap), and which — like B1650 left
  `translations` for days — need a journal-level fact (locale count) this
  registry cannot see from a pure module.
- Follow B1650's own rule: never pre-fill a default on the create card for a
  question nobody was asked (whatever the trip-side equivalent of
  `CARD_PREFILL_TRACKS` turns out to be, if anything carries over at all —
  trips do not have `lib/tracks.ts`'s registry, so this is not a literal
  copy).
- Whatever v2 route the trip write lands on (or the shared domain function,
  if trip creation is still on decision (c) for the reasons B1650 records)
  needs its own completeness gate naming what is missing, the same way
  `POST /api/helper/[user]/day` already does.

## Acceptance

`create_trip`'s press either supplies or declines every one of
`TRIP_DECLINABLES` that applies to the trip being created (accounting for
`listed`/`teaser`'s visibility-conditional rule), and a create attempt silent
on one of them is refused rather than silently written with the field
unanswered. `edit_trip` is unaffected unless the same investigation finds a
matching gap there.
