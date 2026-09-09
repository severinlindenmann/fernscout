---
id: B818
title: The date defaults to today when you are writing up a day from three weeks ago
type: ISSUE
priority: medium
complexity: low
area: agent, ui
found: "2026-09-07T15:30:51Z"
started: "2026-09-07T15:37:36Z"
merged: "2026-09-07T16:05:51Z"
completed: "2026-09-09T16:45:58Z"
---

# B818 — The date defaults to today when you are writing up a day from three weeks ago

## Why

The wizard's date field defaults to **today**, even when it is opened from a
link that says "Finish Wednesday, 19 August".

A person tidying up three weeks after a trip, filling the form on autopilot,
publishes a day dated to the day they happened to be tidying. The capability is
there — a typed back-date filed correctly as "Day 6, Thursday 20 August" — but
the default fights the late writer, and late is when journals actually get
written.

Found by a tester doing the second visit, which nobody had tested before.

## Work

Default to the day the person is most likely to mean: the oldest unwritten day
of the trip in question, or the date the link that opened the wizard names.
Today is the right default only when today is inside a running trip.

## Acceptance

Opening the wizard from "Finish Wednesday, 19 August" offers 19 August.
