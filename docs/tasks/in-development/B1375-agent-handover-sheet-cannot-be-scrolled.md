---
id: B1375
title: Agent handover sheet cannot be scrolled or closed on mobile
type: ISSUE
priority: high
complexity: medium
area: agent helper
found: "2026-09-10T19:12:19Z"
started: "2026-09-10T19:15:32Z"
session: fb660571-5f19-4c13-9493-42fb41b86585
claimed: "2026-09-10T19:15:32Z"
---

# B1375 — Agent handover sheet cannot be scrolled or closed on mobile

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Findings and fix (2026-09-10, branch agent-mobile-fixes)

Investigated: the agent sheet in HelperRoom.tsx (B1209/B1210 Sheet) already carries a Schliessen header and an overflow-y-auto body in current code; the screenshot may predate or be the same scroll-container bug as B1374, which is now fixed. Needs a live retest on iPhone before closing; if it still sticks, reopen with what the sheet shows.
