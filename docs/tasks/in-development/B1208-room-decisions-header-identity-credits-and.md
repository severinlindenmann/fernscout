---
id: B1208
title: Room decisions: header identity, credits and the overflow menu (D53 D06 D07 D08 D10 D17 D43)
type: FEATURE
priority: high
complexity: medium
area: helper room
found: "2026-09-10T04:39:35Z"
started: "2026-09-10T04:41:15Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-10T04:41:15Z"
---

# B1208 — Room decisions: header identity, credits and the overflow menu (D53 D06 D07 D08 D10 D17 D43)

## Why

Owner's decision round of 2026-09-10 (see docs/plans/2026-09-10-room-decisions.md for the full list): D53 (owner's addition), D06, D07, D08, D10, D17,
D43. The header must say which journal is being edited — the name plus the
clickable path ("/severin") linking to the journal. A credit chip sits in
the header whenever the instance charges (tap = account sheet), turning
coral with a one-line "Guthaben kaufen" warning above the composer at ~10
turns left; the chip's sheet shows this conversation's ≈ cost and the
month's. An overflow ⋯ menu collects language, account, bring-agent;
"Start over" is removed outright (the + covers it). The whole app caps at
~1680px centered.

## Work

Header: journal title + mono "/username" both linking to /<username>;
credit chip (server passes balance; hidden when charging is off); ⋯ menu
(a small popover, keyboard-reachable); remove the Start-over control from
the composer; width cap wrapper. Low-credit line above the composer at
threshold, linking to the purchase page. Cost figures come from the usage
table via a small owner-only helper route (conversation + month, units
priced like /admin does).

## Acceptance

At 390 and 1440: the journal is named and clickable; the chip shows the
real balance and opens the sheet; with a scripted low balance the warning
appears; no Start-over anywhere; content centered on a 2560px window.
