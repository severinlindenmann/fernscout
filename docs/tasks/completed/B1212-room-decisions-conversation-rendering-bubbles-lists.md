---
id: B1212
title: Room decisions: conversation rendering — bubbles, lists, time marks, retry, chips, dedupe (D02 D21 D22 D20 D18 D23)
type: FEATURE
priority: high
complexity: medium
area: helper room
found: "2026-09-10T04:39:37Z"
started: "2026-09-10T05:24:23Z"
merged: "2026-09-10T05:40:49Z"
---

# B1212 — Room decisions: conversation rendering — bubbles, lists, time marks, retry, chips, dedupe (D02 D21 D22 D20 D18 D23)

## Why

Owner's decision round of 2026-09-10 (see docs/plans/2026-09-10-room-decisions.md for the full list): D02 A, D21 A, D22 B, D20 A, D18 A, D23 A. The
conversation reads better: own messages right-aligned in a quiet bubble;
simple lists and bold render in answers; a quiet time marker every ~10
minutes; every failure row carries "Nochmal versuchen" re-sending the
same sentence; server-curated situation chips after key moments (after a
save: publish/photo; after publish: next day); identical duplicate
proposals in one turn collapse to one (B1202).

## Work

HelperAsk rendering + AnswerText growth (lists, bold); chips come from
the routes' answers as a small `suggest` field, drawn as chips through
the existing go(); dedupe in the ask/proposal assembly (closes B1202).

## Acceptance

Each behaviour visible in a browser; new unit tests for AnswerText
shapes and proposal dedupe; B1202 closes with this ticket.
