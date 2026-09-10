---
id: B1217
title: Room decisions: history — clean titles, search, a Tage tab (D35 D36 D44)
type: FEATURE
priority: high
complexity: medium
area: helper room
found: "2026-09-10T04:39:40Z"
---

# B1217 — Room decisions: history — clean titles, search, a Tage tab (D35 D36 D44)

## Why

Owner's decision round of 2026-09-10 (see docs/plans/2026-09-10-room-decisions.md for the full list): D35 A, D36 A, D44 A. History grows up: titles are
cleaned server-side (fall back to the day/trip touched when the first
message was a chip sentence); a search field matches stored turns
(owner-only); and a second "Tage" tab lists the current trip's days with
Entwurf/online badges, each opening the preview.

## Work

sessionsOf title derivation; a search param on the sessions route; the
panel gets tabs (Verlauf default). Tage rows from the existing drafts/
days reads.

## Acceptance

Search finds a word from an old conversation; Tage shows correct
badges on the demo journal; titles for chip-opened conversations name
the day.
