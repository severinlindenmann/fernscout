---
id: B1380
title: Uploaded videos get no thumbnail in the Dateien tab
type: ISSUE
priority: medium
complexity: low
area: agent helper
found: "2026-09-10T19:12:22Z"
started: "2026-09-10T19:15:35Z"
session: fb660571-5f19-4c13-9493-42fb41b86585
claimed: "2026-09-10T19:15:35Z"
---

# B1380 — Uploaded videos get no thumbnail in the Dateien tab

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Findings and fix (2026-09-10, branch agent-mobile-fixes)

Root cause: filesForRoom pointed every media tile at the sharp thumbnail route, which 404s for video; the tile rendered a broken <img>. InboxFileGroups now falls back to the typed film icon for video. No poster frames (no ffmpeg by design).
