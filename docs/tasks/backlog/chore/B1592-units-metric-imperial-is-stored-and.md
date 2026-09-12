---
id: B1592
title: units (metric/imperial) is stored and editable but nothing converts by it
type: CHORE
priority: low
complexity: low
area: journal config
found: "2026-09-12T15:06:13Z"
---

# B1592 — units (metric/imperial) is stored and editable but nothing converts by it

## Why

`units: "metric" | "imperial"` is in every journal's config (lib/config.ts:252),
editable on /me, and exported — but no renderer reads it: weather renders °C
and distances render km regardless. Found during the B1587 v2 schema review,
where the field was made required on the journal document on the assumption
it does something.

## Work

Either honour it (convert temperature, wind, distance at render time) or
retire it from /me and the config. A field a person can set that changes
nothing is worse than either.

## Acceptance

An imperial journal shows °F and miles on a day with weather and a track —
or the toggle is gone from /me.
