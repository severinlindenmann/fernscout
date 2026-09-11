---
id: B1207
title: Room decisions: the Clean App restyle and open two-column proposal cards (D01 D05)
type: FEATURE
priority: high
complexity: high
area: helper room
found: "2026-09-10T04:39:34Z"
started: "2026-09-10T04:41:15Z"
merged: "2026-09-10T05:07:07Z"
---

# B1207 — Room decisions: the Clean App restyle and open two-column proposal cards (D01 D05)

## Why

Owner's decision round of 2026-09-10 (see docs/plans/2026-09-10-room-decisions.md for the full list): D01 B and D05 B. The room's look is judged flat; the
owner chose the "Clean App" direction — drop most cream inside the room:
white/near-white surfaces, tighter radii, more whitespace, stronger type
hierarchy, yellow reserved for the one primary action. Proposal cards keep
their fields open but become a two-column grid on desktop with a clearer
per-decision-kind header.

## Work

Room-scoped restyle (the journal pages keep their brand): a token pass
over HelperRoom/HelperAsk/RoomOpening — surface colors, radii, spacing,
card headers. Proposal fields in a 2-col grid ≥sm. No layout mechanics
change. The one bright pressable rule holds.

## Acceptance

Screenshots at 390/1440 in every core state (opening, conversation,
proposal card, files, history) read as one coherent white system;
`agent-door-calm`-family tests still pass.
