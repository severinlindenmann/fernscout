---
id: B1196
title: One ambiguous date correction proposes shifting the whole trip's dates
type: ISSUE
priority: high
complexity: low
area: helper
found: "2026-09-09T22:34:28Z"
started: "2026-09-09T22:35:06Z"
merged: "2026-09-09T22:42:17Z"
---

# B1196 — One ambiguous date correction proposes shifting the whole trip's dates

## Why

Persona round (Elena): "actually that was the 3rd, not the 2nd" — about a
single day — produced two simultaneous proposals: the correct new-day one,
and one shifting the whole trip's start from 09-01 to 09-03, which
accepted by mistake would have silently cut two days out of the trip's
range. A person correcting one day should never be offered a trip-wide
date change as a side dish.

## Work

The trip-dates tool's `describe` gains the boundary ("never for correcting
one day's date — that is the day's own date field"), which is where every
similar steering fix has stuck (tool describe over prompt, B829 lineage).
If a later round shows the describe alone does not hold, a server guard on
"trip-dates proposal in the same turn as a day-date proposal" is the next
step — not taken now.

## Acceptance

Rerunning Elena's sentence on the live site yields a day correction and no
trip-dates proposal (persona retest).

## Verified live, 2026-09-10 02:0x CEST

Re-ran the exact scenario on fernscout.ch (test-elena, fresh day on
2026-09-05, then "actually that was the 6th, not the 5th"): the reply
proposed only the day-level fix — a new day on 2026-09-06 — and no card
anywhere referenced the trip's start or end. The describe boundary holds
against the live model. Screenshot: .playwright-mcp/b1196-check.png.
One unrelated observation from the same reply captured as B1202.
