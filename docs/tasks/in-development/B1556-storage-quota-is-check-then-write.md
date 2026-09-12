---
id: B1556
title: Storage quota is check-then-write — parallel uploads pass the ceiling arbitrarily
type: SECURITY
priority: medium
complexity: medium
area: storage/quota
found: "2026-09-11T23:06:54Z"
started: "2026-09-12T07:22:50Z"
session: 5c987a64-dfc0-4ac9-9b57-3804213ba1b8
claimed: "2026-09-12T07:22:50Z"
---

# B1556 — Storage quota is check-then-write — parallel uploads pass the ceiling arbitrarily

## Why

`lib/storageQuota.ts:183-204`: `storageRefusal()` walks the directory and
answers from the pre-write total; nothing reserves the incoming bytes. Every
writer (`lib/api/media.ts:401`, `lib/inboxUpload.ts:180`,
`app/api/v1/[user]/import/route.ts:260`, `lib/whatsapp/dispatch.ts:550`,
`attachOriginal`) does check → write with no lock, so N concurrent uploads all
see the same pre-write total and all pass. A journal at 4.9 GB of a 5 GB
ceiling firing 50 parallel 500 MB video uploads lands ~25 GB on disk without
buying storage. Needs a valid token, but signup is self-serve (see B1553), so
a bot journal converts this into a disk-fill against the operator.

## Work

Serialise check+write per journal — a per-username mutex around
`storageRefusal` + write, or a reserved-bytes counter the check includes.
The guard's placement is otherwise right (checked before writing in every
caller); the race is the only gap.

## Acceptance

A test firing parallel uploads that individually fit but jointly exceed the
ceiling ends with total bytes on disk within ceiling + one upload's size, the
rest refused with the storage advice.
