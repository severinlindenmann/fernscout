---
id: B1202
title: One reply can carry the same proposal card twice, verbatim
type: ISSUE
priority: low
complexity: low
area: helper
found: "2026-09-10T00:05:18Z"
merged: "2026-09-10T05:40:50Z"
---

# B1202 — One reply can carry the same proposal card twice, verbatim

## Why

B1196's live verification (2026-09-10, test-elena): "actually that was the
6th, not the 5th" answered with the correct day-level proposal — rendered
twice, verbatim, in one reply: two identical "A day for 2026-09-06" cards
with identical fields and buttons. Harmless (either press does the same
thing, the second card settles as "left it") but it reads as a stutter,
and two pressable copies of one decision is one too many.

## Work

Find where a turn's proposals are collected (the model calling the same
write tool twice in one turn, or a block duplicated between the tool
result and the answer assembly) and de-duplicate identical proposals —
same tool, same arguments — before the turn is answered.

## Acceptance

A scripted turn whose model output proposes the same tool with the same
arguments twice renders one card.
