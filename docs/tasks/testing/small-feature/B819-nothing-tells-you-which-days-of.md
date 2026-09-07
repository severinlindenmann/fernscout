---
id: B819
title: Nothing tells you which days of your trip were never written
type: FEATURE
priority: medium
complexity: low
area: agent, ui
found: "2026-09-07T15:30:52Z"
started: "2026-09-07T15:37:36Z"
merged: "2026-09-07T16:05:51Z"
---

# B819 — Nothing tells you which days of your trip were never written

## Why

The wizard's unfinished list shows drafts that **exist**. Days that were never
started do not appear anywhere.

A tester's trip ran 14–21 August with six days written; two were never begun.
Nothing on `/agent` or `/agent/<user>` said so. To write them she had to already
know which dates were missing and type them in.

The journal knows the trip's dates and knows which days exist. The gap is
computable and is the single most useful thing to show somebody returning to a
half-finished trip.

## Work

Show the gap: "your trip ran eight days and two were never written — 20 and 21
August", each one a link that opens the wizard on that date (which needs B818).

Be careful not to nag: a trip where somebody deliberately wrote three days out
of fourteen is not a to-do list with eleven failures on it. Say it once, quietly,
and let it be dismissed.

## Acceptance

A returning owner sees which days of a finished trip were never written, and
can start one in a tap.
