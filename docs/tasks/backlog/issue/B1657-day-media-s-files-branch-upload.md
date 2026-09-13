---
id: B1657
title: day/media's files-branch upload bypasses the storage quota
type: ISSUE
priority: medium
complexity: low
area: Helper / inbox
found: "2026-09-13T10:04:04Z"
---

# B1657 — day/media's files-branch upload bypasses the storage quota

## Why

Found while checking B1656 (repointing helper inbox/media tools at v2).

`POST /api/helper/[user]/day/media` (`app/api/helper/[user]/day/media/route.ts:162-167`)
stores a non-photograph upload straight into the inbox with:

```ts
if (kind === "files") {
  const stored = storeInboxFile(user, "files", file.name, bytes, {});
  return Response.json({ ok: true, inbox: stored.entry.id, existed: stored.existed }, { status: 201 });
}
```

`storeInboxFile` (`lib/inbox.ts:218`) itself does not check the per-journal
storage ceiling — every other caller wraps it in `withStorageQuota`:
`receiveInboxUpload` does (`lib/inboxUpload.ts:206`), and so does v2's
`POST /api/v2/{user}/media` (`lib/api/v2/media.ts`, the inbox-decline path).
This one call site does not, so a document dropped on the room's upload door
lands regardless of whether the journal is already at its `perUserBytes`
ceiling — the exact bypass AGENTS.md's storage section says the inbox must
not be.

## Work

Wrap the `storeInboxFile` call in `withStorageQuota(user, bytes.byteLength,
...)`, matching the shape `receiveInboxUpload` already uses, and return the
same `storage_full` shape those callers do when it refuses.

## Acceptance

A non-photograph upload to `POST /api/helper/[user]/day/media` on a journal
already at its storage ceiling is refused rather than written; a test pins
it (mirroring however `test/helper-inbox-upload.test.ts` or
`test/storage-quota.test.ts` already checks the other two doors).
