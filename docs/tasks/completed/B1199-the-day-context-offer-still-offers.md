---
id: B1199
title: The day-context offer still offers taking a draft off the site
type: ISSUE
priority: low
complexity: low
area: helper room
found: "2026-09-09T22:34:30Z"
started: "2026-09-09T22:45:04Z"
merged: "2026-09-09T22:51:40Z"
---

# B1199 — The day-context offer still offers taking a draft off the site

## Why

Persona round (Elena): the day-context offer (B994) always includes "Take
this day off the site", including for a day that is already a draft. A
stale offer is a small lie about the day's state.

## Work

The offer's options read the preview's own `draft` flag once it lands
(HelperRoom already holds it) — show unpublish only for a published day,
or swap it for "Put this day on the site" on a draft.

## Acceptance

The offer under a draft day carries no take-down option.
