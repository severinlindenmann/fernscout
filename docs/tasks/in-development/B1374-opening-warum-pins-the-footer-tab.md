---
id: B1374
title: Opening warum pins the footer tab bar mid-page and the consent text cannot scroll
type: ISSUE
priority: high
complexity: medium
area: agent helper
found: "2026-09-10T19:12:18Z"
started: "2026-09-10T19:15:32Z"
session: fb660571-5f19-4c13-9493-42fb41b86585
claimed: "2026-09-10T19:15:32Z"
---

# B1374 — Opening warum pins the footer tab bar mid-page and the consent text cannot scroll

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Findings and fix (2026-09-10, branch agent-mobile-fixes)

Root cause shared with B1379: the chat column (<main> in HelperRoom.tsx) had no scroll container of its own, so overflow scrolled the document and every sticky element stuck to the wrong thing. Fixed with overflow-y-auto overscroll-contain on the chat column. Check on a phone: expand 'warum?' — text scrolls, tab bar stays at the bottom.
