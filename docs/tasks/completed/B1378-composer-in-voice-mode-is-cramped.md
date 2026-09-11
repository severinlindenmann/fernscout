---
id: B1378
title: Composer in voice mode is cramped and the speech level animation never shows
type: ISSUE
priority: high
complexity: medium
area: agent helper
found: "2026-09-10T19:12:21Z"
started: "2026-09-10T19:15:34Z"
merged: "2026-09-10T19:34:26Z"
---

# B1378 — Composer in voice mode is cramped and the speech level animation never shows

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Findings and fix (2026-09-10, branch agent-mobile-fixes)

Language select now takes its own row (basis-full, flex-wrap) and the textarea keeps usable width (min-w + flex-1). The speaking animation never existed; added an AnalyserNode level meter that pulses the mic button while recording.
