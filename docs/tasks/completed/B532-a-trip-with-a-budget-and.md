---
id: B532
title: A trip with a budget and no day-level spending reads as complete
type: FEATURE
priority: medium
complexity: low
area: api, costs
found: "2026-09-06T09:55:00Z"
started: "2026-09-06T07:53:28Z"
merged: "2026-09-06T08:19:48Z"
completed: "2026-09-07T13:11:43Z"
---

# B532 — A trip with a budget and no day-level spending reads as complete

## Why

The second half of what the import run in B531 found, and the half a contract
at write time does not answer: the trip was already wrong, and every reading
of it said nothing.

`GET .../trips/<trip>/costs` returns the budget and the preparation costs. It
does not say whether a single day of the trip records any spending. A budget
of 3500 CHF over ten days sitting beside **zero** days with costs is a
contradiction anything reading it could see — `"daysWithCosts": 0` of 14 would
have been the whole warning, and the agent read that endpoint back after
writing.

The same run had a second gap of the same kind: three bookings dated 28 June
had nowhere to go, because **no day exists for 28 June** — a date inside the
trip's own `start`/`end`. Which dates in range carry no day is arithmetic
nothing performs.

## Work

- `daysWithCosts` and `days` on the costs response, and the same pair in
  `GET /api/v1/<user>/status`, which is the call an agent makes to find out
  where it stands.
- `datesWithoutADay` — dates between `start` and `end` that no entry covers,
  capped and summarised rather than printing sixty for an upcoming trip.
- A sentence in the response when a budget exists and no day carries costs.
  Naming it is the point; it is not an error and must not be one.

Not doing: the site's own costs page — worth its own capture if the numbers
being thin is still confusing once these exist.

## Acceptance

- `GET .../costs` on a trip with a budget and no day costs carries
  `daysWithCosts: 0` and says so in words.
- `datesWithoutADay` lists 2026-06-28 for a trip whose days skip it.
- `npm run verify` green.
