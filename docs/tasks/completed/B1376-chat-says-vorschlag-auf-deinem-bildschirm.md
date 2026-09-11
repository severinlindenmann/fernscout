---
id: B1376
title: Chat says Vorschlag auf deinem Bildschirm but no button is visible
type: ISSUE
priority: medium
complexity: low
area: agent helper
found: "2026-09-10T19:12:19Z"
started: "2026-09-10T19:15:33Z"
merged: "2026-09-10T19:34:25Z"
---

# B1376 — Chat says Vorschlag auf deinem Bildschirm but no button is visible

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Findings and fix (2026-09-10, branch agent-mobile-fixes)

Proposal cards already call scrollIntoView, but without a real scrolling ancestor (B1374's root cause) that call had nothing to scroll — same fix. Check: ask for a new day on a phone; the proposal button must be visible without hunting.
