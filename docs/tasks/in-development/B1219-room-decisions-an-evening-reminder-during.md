---
id: B1219
title: Room decisions: an evening reminder during a trip (D46)
type: FEATURE
priority: high
complexity: high
area: helper room
found: "2026-09-10T04:39:41Z"
started: "2026-09-10T05:08:54Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-10T05:08:54Z"
---

# B1219 — Room decisions: an evening reminder during a trip (D46)

## Why

Owner's decision round of 2026-09-10 (see docs/plans/2026-09-10-room-decisions.md for the full list): D46 A. Nobody is reminded to write while the trip
is happening (B673's finding). Opt-in per trip, one evening WhatsApp or
mail nudge on days with no entry — set up conversationally ("erinnere
mich abends"), and stoppable the same way.

## Work

A per-trip reminder flag + preferred channel; a nightly sweep (the
backup timer's shape) that sends at most one nudge per journal per day,
only during the trip's dates, only when the day has no entry; a tool to
set/clear it. Supersedes B673 — note it there.

## Acceptance

Dry-run mail on a test journal fires exactly once for a missing day
and never on a written one; opt-out works in one sentence.
