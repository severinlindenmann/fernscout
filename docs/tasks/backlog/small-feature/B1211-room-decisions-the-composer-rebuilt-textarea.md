---
id: B1211
title: Room decisions: the composer rebuilt — textarea, send, voice, drafts, camera (D13 D14 D15 D16 D33)
type: FEATURE
priority: high
complexity: medium
area: helper room
found: "2026-09-10T04:39:36Z"
---

# B1211 — Room decisions: the composer rebuilt — textarea, send, voice, drafts, camera (D13 D14 D15 D16 D33)

## Why

Owner's decision round of 2026-09-10 (see docs/plans/2026-09-10-room-decisions.md for the full list): D13 A, D14 A, D15 A, D16 A, D33 A. The composer
grows up: auto-growing textarea (Enter sends, Shift+Enter breaks; on
phones return breaks and the button sends), a filled yellow circular send
button as the room's one bright thing mid-conversation, a full-size mic
that turns the composer into a level meter with elapsed time and stop
while recording, unsent text persisted per journal, and a camera button
(capture) beside the picker on phones.

## Work

Rework HelperAsk's composer block. Keep every existing behaviour
(focus rules, strip collapse, consent flow). Level meter from the
existing recorder's analyser if available, else a simple pulse. Draft
persistence in localStorage keyed by journal.

## Acceptance

All five behaviours demonstrated in a browser at 390 and 1440;
helper-chat tests updated and green.
