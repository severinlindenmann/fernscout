---
id: B1647
title: costs/apply on a trip cannot find days written through the day-write endpoint
type: ISSUE
priority: high
complexity: medium
area: API v2
found: "2026-09-13T08:38:09Z"
---

# B1647 — costs/apply on a trip cannot find days written through the day-write endpoint

## Why

`POST /api/v2/{user}/trips/{trip}/costs/apply` takes rows keyed by `date` and
is supposed to write each row onto the day already written for that date
(`lib/costs` or wherever the route lives — not located during this OPS pass).
Reproduced live against `fernscout.ch` (commit `07345e79`), journal
`test-v2-replay`, trip `v2-replay-full`:

1. `PUT .../trips/v2-replay-full/days/2026-01-02-full-feature-day` — 201, day
   exists with `"date": "2026-01-02"`, confirmed both via
   `GET .../trips/v2-replay-full` (`days` array) and
   `GET .../trips/v2-replay-full/days` and the on-disk JSON.
2. `POST .../trips/v2-replay-full/costs/apply` with
   `{"rows":[{"date":"2026-01-02","label":"Test train ticket","amount":25,"currency":"CHF","category":"transport"}]}`
   answers `200` with `"written": [], "orphaned": [{"date":"2026-01-02","rows":1}]`
   — as if no day existed on that date.

Tried again with the day published, then again with it back in draft: same
result both times. The day is unambiguously there and answers on its own
`GET`; the route's own day lookup does not find it. This makes `costs/apply`
unusable for exactly the case B540 exists to catch — an agent that wrote a day
through the real API cannot then apply a bank statement to it, and the
response gives no hint why (it reads as "you haven't written that day yet",
which is false).

## Work

Find where `costs/apply` resolves `rows[].date` to a day and work out why it
misses a day that `GET .../days` finds by the same trip and date. Likely
candidates: a stale index/cache the route reads instead of scanning `entries/`
live, or a mismatch between how the route's day-lookup keys days (slug prefix?
frontmatter parse?) and how the day-write endpoint just wrote one.

## Acceptance

`PUT` a day at a given date through the v2 API, then `POST costs/apply` with a
row at that same date: the row is written to the day (`"written"` names it,
`"orphaned"` is empty), and a `GET` on the day shows the cost line.
