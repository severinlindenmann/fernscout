---
id: B1570
title: Helper GPS import and photobook order still use unlocked storageRefusal check
type: ISSUE
priority: medium
complexity: low
area: storage/quota
found: "2026-09-12T08:55:00Z"
---

# B1570 — Helper GPS import and photobook order still use unlocked storageRefusal check

## Why

B1556 serialised quota-check-plus-write behind `withStorageQuota()` in
`lib/storageQuota.ts` for the callers its ticket named. Two callers with the
same check-then-write shape were not named and kept the plain, unlocked
`storageRefusal()`: `app/api/helper/[user]/import/route.ts` (the helper GPS
import — writes real bytes via `importGps` after the check) and
`app/[user]/photobook/order/route.ts` (a nominal check). The helper import in
particular can still race past the ceiling the way B1556's other callers
could.

## Work

Move the helper GPS import's check+write inside `withStorageQuota()`, same as
`app/api/v1/[user]/import/route.ts` was in B1556. Decide whether the photobook
order's nominal check is worth locking or fine as advisory.

## Acceptance

The helper import's quota path is covered by the same concurrent-uploads test
shape `test/storage-quota.test.ts` gained in B1556.
