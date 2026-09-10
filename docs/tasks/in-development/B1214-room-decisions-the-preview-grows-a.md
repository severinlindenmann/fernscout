---
id: B1214
title: Room decisions: the preview grows a header, memory, publish and highlights (D24 D25 D26 D27)
type: FEATURE
priority: high
complexity: medium
area: helper room
found: "2026-09-10T04:39:38Z"
started: "2026-09-10T06:03:02Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-10T06:03:02Z"
---

# B1214 — Room decisions: the preview grows a header, memory, publish and highlights (D24 D25 D26 D27)

## Why

Owner's decision round of 2026-09-10 (see docs/plans/2026-09-10-room-decisions.md for the full list): D24 B, D25 A, D26 A, D27 A. The preview gets a
real header (day title + date, "Auf der Seite öffnen" for published days,
collapse control), remembers the person's last open/collapsed choice, a
draft's header carries "Auf die Seite stellen" opening the normal
confirmation card in the conversation (never publishing directly), and an
accepted write scrolls to and briefly highlights the changed passage.

## Work

PreviewColumn/pane header; persistence of collapsed state; the publish
button posts the same proposal the conversation would; highlight by
diffing the previous/next day text client-side (coarse: first changed
block).

## Acceptance

Demonstrated in a browser on a real draft; the publish path provably
goes through the existing confirm card.
