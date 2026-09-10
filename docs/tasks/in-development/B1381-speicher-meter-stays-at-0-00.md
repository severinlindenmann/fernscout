---
id: B1381
title: Speicher meter stays at 0.00 GB after uploads
type: ISSUE
priority: medium
complexity: low
area: agent helper
found: "2026-09-10T19:12:22Z"
started: "2026-09-10T19:15:35Z"
session: fb660571-5f19-4c13-9493-42fb41b86585
claimed: "2026-09-10T19:15:35Z"
---

# B1381 — Speicher meter stays at 0.00 GB after uploads

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Findings and fix (2026-09-10, branch agent-mobile-fixes)

Root cause: StorageLine's GB-only formatter — a few MB rounds to 0.00 GB; the refetch-on-upload wiring (B1350) was fine. Now unit-aware (KB/MB/GB, mirrors lib/storageQuota.ts formatBytes); accountStorageOf strings no longer hard-code GB.
