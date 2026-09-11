---
id: B1051
title: The helper's own door has no invites, revoke_invite, tell_readers or channels
type: FEATURE
priority: medium
complexity: medium
area: lib/helper/tools/areas/readers.ts, app/api/helper
found: "2026-09-09T08:22:04Z"
merged: "2026-09-09T08:22:04Z"
completed: "2026-09-11T00:00:00Z"
---

# B1051 — The helper's own door has no invites, revoke_invite, tell_readers or channels

## Why

This file was never committed alongside the work it should have described.
Commit `e722ee52` ("B1051: invites, revoke_invite, tell_readers and channels
for the helper") shipped four capabilities on the wizard's own door, and ten
sites in the tree cite `B1051` by name —
`app/api/helper/[user]/invite/revoke/route.ts:10`,
`app/api/helper/[user]/day/tell-readers/route.ts:15`,
`app/api/helper/[user]/channels/route.ts:9`, four comments in
`lib/helper/tools/areas/readers.ts` (lines 67, 121, 157, 245),
`test/helper-readers.test.ts:14`, and four in `test/helper-thread.test.ts`
(475, 501, 522, 532) — but `docs/tasks/` had no file behind any of them.
`nextId()` allocates from what is on disk, so the number was handed out again
to an unrelated capture on 2026-09-09 (see B1052). The number is burnt either
way; what was missing was the record.

This file writes that record rather than rewriting ten citations to point
somewhere else — the work is real, merged, and this is what it was.

## Work

Four capabilities added to `lib/helper/tools/areas/readers.ts`, all reached
from the guided web helper's own conversational door and none proxying to
`/api/v1`:

- **`invites`** (read, choose) — lists every invite link this journal has
  issued: kind, who it was for, when, used or revoked. Reads
  `listInvites()` and never the live token, which `AGENTS.md` says is shown
  once, at issue.
- **`revoke_invite`** (write, confirm) — takes one link back by id. Everybody
  already approved through it keeps their access; this only stops a new
  redemption.
- **`tell_readers`** (write, confirm) — announces a published day by mail or
  WhatsApp, one tool with a `channel` field rather than two separate tools,
  since a person says "tell them" and not which transport. The confirmation
  card names how many people it reaches (`mailWouldReach` /
  `whatsappWouldReach`, the same functions the v1 routes send with) and, for
  WhatsApp, what it spends. Refuses a day still in draft.
- **`channels`** (write, form) — turns this journal's mail or WhatsApp
  sending on or off, mirroring `POST /api/v1/<user>/channels` through the
  same `setJournalFeatures()`.

Three new helper routes — `invite/revoke`, `day/tell-readers`, `channels` —
all cookie-only and owner-only like the rest of the helper family. None
proxies to `/api/v1`; each calls the same `lib` functions the v1 routes call
(`revokeInvite`, `sendDayLetter`/`sendDayWhatsapp`, `setJournalFeatures`).

Not doing: renumbering. `nextId()` behaved correctly; the file was simply
never committed.

## Acceptance

- `test/helper-readers.test.ts` and `test/helper-thread.test.ts` cover all
  four capabilities and pass.
- `npm run tasks` shows `B1051` with a file, so the next sweep for orphaned
  citations does not find it again.
