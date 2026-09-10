---
id: B1326
title: The room's light mode is white-grey while the rest of the site is cream-navy
type: ISSUE
priority: high
complexity: low
area: helper
found: "2026-09-10T15:59:35Z"
started: "2026-09-10T15:59:54Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-10T15:59:54Z"
---

# B1326 — The room's light mode is white-grey while the rest of the site is cream-navy

## Why

`/agent` in light mode sat on `bg-navy-50` — a cool grey — while every other
page of the site sits on cream (`--background: cream-50`). The room read as a
different product bolted on (owner's ask, 2026-09-10).

## Work

- `HelperRoom.tsx`: room ground `bg-navy-50` → `bg-cream-50`; panels stay
  white, matching the site's cards-on-cream pattern.
- `globals.css`: `.fs-room-dark.bg-cream-50` added to the dark-room root rule
  so the dark toggle keeps its darker ground (#171d29) distinct from panels.

## Acceptance

On desktop light mode the room's ground computes to `rgb(255, 250, 240)`
(cream-50); with the dark toggle on it is `rgb(23, 29, 41)` as before.
Checked in Playwright on 2026-09-10.
