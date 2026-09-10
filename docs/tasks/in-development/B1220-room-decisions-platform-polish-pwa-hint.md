---
id: B1220
title: Room decisions: platform polish — PWA hint, haptics, shortcuts, wizard retirement (D40 D41 D42 D52)
type: FEATURE
priority: high
complexity: medium
area: helper room
found: "2026-09-10T04:39:41Z"
started: "2026-09-10T06:24:05Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-10T06:24:05Z"
---

# B1220 — Room decisions: platform polish — PWA hint, haptics, shortcuts, wizard retirement (D40 D41 D42 D52)

## Why

Owner's decision round of 2026-09-10 (see docs/plans/2026-09-10-room-decisions.md for the full list): D40 A, D41 A, D42 A, D52 A. Platform polish: a
dismissible add-to-homescreen hint after the second visit; a short
vibration on an accepted write and record start/stop; ⌘K new
conversation, ⌘/ focus, Esc closes panes with a "?" cheatsheet; and the
old wizard page retires — add_photos points at the room's own files
pane, /agent/<user> redirects to /agent, dead code goes.

## Work

Four small independent pieces; the wizard retirement lands last and
alone (biggest deletion), with the contract check run for the changed
tool text.

## Acceptance

Hint shows on second visit only; shortcuts work; wizard URL redirects;
knip stays clean after the deletion.
