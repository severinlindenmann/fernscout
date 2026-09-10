---
id: B1209
title: Room decisions: the account sheet with display settings (D09 D03 D04)
type: FEATURE
priority: high
complexity: medium
area: helper room
found: "2026-09-10T04:39:35Z"
---

# B1209 — Room decisions: the account sheet with display settings (D09 D03 D04)

## Why

Owner's decision round of 2026-09-10 (see docs/plans/2026-09-10-room-decisions.md for the full list): D09 B, D03 B, D04 B. A minimal account sheet in
the room (bottom sheet on phone, side panel on desktop): balance + buy
link, the storage bar — plus the two display settings the owner chose:
text size S/M/L and a manual dark-mode toggle for the room. Keys stay on
/me.

## Work

One sheet component fed by a small owner-only route (balance, storage
used/ceiling, month usage). S/M/L scales the conversation type via a root
class persisted in localStorage; the dark toggle applies a room-scoped
theme class (design the dark palette from the journal's navy/cream,
room only).

## Acceptance

Sheet opens from chip and ⋯; settings persist across reload; dark room
at 390px has no unreadable pairings (checked in a browser).
