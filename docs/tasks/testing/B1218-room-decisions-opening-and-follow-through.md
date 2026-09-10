---
id: B1218
title: Room decisions: opening and follow-through — progress, undo, weather, costs, share (D45 D47 D48 D49 D51)
type: FEATURE
priority: high
complexity: medium
area: helper room
found: "2026-09-10T04:39:40Z"
started: "2026-09-10T06:24:03Z"
merged: "2026-09-10T07:05:13Z"
---

# B1218 — Room decisions: opening and follow-through — progress, undo, weather, costs, share (D45 D47 D48 D49 D51)

## Why

Owner's decision round of 2026-09-10 (see docs/plans/2026-09-10-room-decisions.md for the full list): D45 A, D47 A, D48 A, D49 A, D51 A. Follow-through:
the opening shows trip progress ("Tag 5 von 14 — 2 Tage noch nicht
erzählt") with missing-date chips; every accepted text write offers
"Rückgängig" (server keeps one prior version per day); a saved day with
coordinates offers one "Wetter nachschlagen lassen" chip (the documented
server lookup); a "+ Ausgabe" chip on the day context opens a prefilled
cost proposal; after publishing, the done-card carries the system share
sheet with the day's URL.

## Work

Opening state from the existing gaps read; a one-deep undo store per
day feeding a restore proposal; the weather chip triggers the existing
lookup route for that day; share via navigator.share with the URL-only
fallback.

## Acceptance

Each chip demonstrated; undo provably restores the prior words through
a pressed card; weather chip never writes a guessed value.
