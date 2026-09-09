---
id: B1188
title: A trip with no days yet greets its owner with 'the last of it undefined, NaN undefined'
type: ISSUE
priority: high
complexity: low
area: helper
found: "2026-09-09T21:26:15Z"
started: "2026-09-09T21:26:47Z"
merged: "2026-09-09T21:33:48Z"
---

# B1188 — A trip with no days yet greets its owner with 'the last of it undefined, NaN undefined'

## Why

Persona round (Jonas, live site, 2026-09-09): right after creating a trip
with no days, the room's opening read "Everything is written and on the
site — the last of it undefined, NaN undefined." That is the `clear` state
of `lib/helper/opening.ts` with no `lastDate` — `formatLongDate(undefined)`
renders "undefined, NaN undefined". A brand-new trip is the very first
thing every new owner sees, and it greets them with NaN.

## Work

`openingFor`: a journal whose trips have no days at all is not "all clear,
the last day was <date>" — it is "your trip is ready, describe your first
day". Either a guard mapping the no-days case to a state with a sentence of
its own, or reusing `empty`'s offer with the trip's name. Words in en/de/hu.

## Acceptance

A journal with one trip and zero days opens with a real sentence naming no
NaN; a vitest on openingFor covers the no-days trip.
