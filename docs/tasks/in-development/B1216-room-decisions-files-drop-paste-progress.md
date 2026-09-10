---
id: B1216
title: Room decisions: files — drop, paste, progress rings, nudge, tile menu (D29 D30 D31 D32 D34)
type: FEATURE
priority: high
complexity: medium
area: helper room
found: "2026-09-10T04:39:39Z"
started: "2026-09-10T06:12:32Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-10T06:12:32Z"
---

# B1216 — Room decisions: files — drop, paste, progress rings, nudge, tile menu (D29 D30 D31 D32 D34)

## Why

Owner's decision round of 2026-09-10 (see docs/plans/2026-09-10-room-decisions.md for the full list): D29 A, D30 A, D31 A, D32 A, D34 A. Files feel
direct: the whole room is a desktop drop target (full-window overlay) into
the inbox; ⌘V pastes an image; uploads show per-file thumbnails with
progress rings; when files land while a day is under discussion one chip
offers "Die neuen auf den Tag legen?"; tiles get a long-press/right-click
menu whose actions (attach to the current day, discard) open the same
confirmation proposals the conversation uses — never a direct write.

## Work

Drop/paste handlers feeding the existing inbox upload; object-URL
thumbnails during flight; the nudge chip and menu actions post to the
proposal route so every write stays a pressed card.

## Acceptance

Each behaviour demonstrated in a browser; the menu's attach provably
renders a confirm card rather than moving anything.
