---
id: B1178
title: ?c=new sticks in the address bar and blanks a live conversation on reload
type: ISSUE
priority: medium
complexity: low
area: helper room
found: "2026-09-09T20:30:38Z"
started: "2026-09-09T20:31:01Z"
merged: "2026-09-09T20:44:33Z"
---

# B1178 — ?c=new sticks in the address bar and blanks a live conversation on reload

## Why

B1168 sends the + button to `/agent?c=new`, which draws a blank room.
The parameter stays in the address bar, so a reload after the person has
started talking draws the room blank again while the thread is live — the
next sentence silently continues a conversation the screen no longer
shows. The same URL bookmarked is a permanently-blank room.

## Work

Replace the URL with plain `/agent` once the room has mounted
(`history.replaceState`), so a reload goes through the ordinary
resume-if-live path.

## Acceptance

Press +, type nothing, reload: still blank (no live thread). Press +,
imagine a turn (or seed one), reload: the live conversation is drawn.
