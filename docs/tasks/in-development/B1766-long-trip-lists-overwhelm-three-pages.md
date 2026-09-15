---
id: B1766
title: Long trip lists overwhelm three pages: storage, what you can read, and the trips index
type: ISSUE
priority: medium
complexity: low
area: Account, me and trips pages
found: "2026-09-15T06:06:39Z"
started: "2026-09-15T06:06:50Z"
session: 7163371b-1cbb-42e5-9fff-437a9b5a0580
claimed: "2026-09-15T06:06:50Z"
---

# B1766 — Long trip lists overwhelm three pages: storage, what you can read, and the trips index

## Why

A journal with many trips turns three owner-facing lists into a wall. On
`/<user>/account` the storage legend prints one row per trip; on `/<user>/me`
"What you can read" prints every readable trip; on `/<user>/trips` the cards
below the world map print every trip in the journal. Each is a scroll rather
than an answer.

## Work

- Account storage legend: already sorted biggest first — cap the legend and the
  bar at the ten largest, with a "Show more" button revealing the rest.
- `/<user>/me`: order the readable trips newest first and show five, then the
  same "Show more".
- `/<user>/trips`: the world map keeps drawing every route; the cards below show
  the six newest, then "Show more".
- One shared `common.showMore` string in en/de/hu.

## Acceptance

- Nothing is unreachable: every capped list reveals the rest in one press.
- The trips map still draws every visible route before and after the press.
- `npm run verify` passes; the three pages check out in a browser at desktop
  and phone width.
