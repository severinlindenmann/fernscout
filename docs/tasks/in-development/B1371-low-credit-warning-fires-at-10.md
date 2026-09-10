---
id: B1371
title: Low-credit warning fires at 10 days left and cannot be dismissed
type: ISSUE
priority: medium
complexity: low
area: agent helper
found: "2026-09-10T19:12:17Z"
started: "2026-09-10T19:15:30Z"
session: fb660571-5f19-4c13-9493-42fb41b86585
claimed: "2026-09-10T19:15:30Z"
---

# B1371 — Low-credit warning fires at 10 days left and cannot be dismissed

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Findings and fix (2026-09-10, branch agent-mobile-fixes)

Threshold moved from credits<=10 to <=5 in HelperRoom.tsx; banner now has a dismiss X (sessionStorage per journal); locale strings no longer hard-code 'ten days'. Check: banner absent at 10 credits, present at 5, X hides it for the session.
