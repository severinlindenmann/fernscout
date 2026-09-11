---
id: B1354
title: A deleted journal's name can only be freed with a shell on the server
type: FEATURE
priority: medium
complexity: low
area: app/admin
found: "2026-09-10T17:33:41Z"
merged: "2026-09-10T17:49:46Z"
---

# B1354 — A deleted journal's name can only be freed with a shell on the server

## Why

Deleting a journal writes `content/.deleted/<name>.json`, and that record is
what keeps the name from being handed to the next person who types it:
`isReservedUsername` in `lib/users.ts:88` counts it as taken and `proxy.ts`
answers 410 on every old URL. Right by default, and wrong in one case — the
person who deleted the journal wants their own name back, which is exactly what
happens when somebody re-runs onboarding.

The only way to say so was `rm content/.deleted/<name>.json` on the box.
`AGENTS.md` says as much in the content-model table ("an operator frees the
name by deleting the file"), and `/admin` — the one page that is about the
instance rather than a journal — showed the tombstones as a **count** on the
Roster card and offered nothing to do about them.

## Work

- `app/api/admin/tombstones/route.ts` — `POST { user }` → `clearTombstone`.
  Cookie-only and 404 to everybody else, the same shape as
  `app/api/admin/refunds/route.ts` beside it. No mailed second step: this
  lowers a barrier rather than raising a balance, which is the line
  `lib/credits.ts` draws for the grant route.
- `app/admin/ReleaseName.tsx` — a `ConfirmPanel` whose question says what it
  does **not** do. "Release" beside a deleted journal reads like undelete, and
  the content went when it was deleted.
- `Roster` in `app/admin/page.tsx` lists the held names instead of counting
  them: `/name`, its old title, the date it went, and the button. Journal
  tombstones only — a trip's holds no name back.

Not doing: restoring anything, and no export. The bytes are not on disk to
restore from; a backup is the operator's own business and `scripts/backup.sh`
already has it.

Not doing: a guard for "that name is a live journal again". It cannot happen —
a tombstone makes `getUsernames` skip the directory, and `createJournal` clears
the tombstone when a name is reclaimed, so the two states never coexist. Tried
it, wrote the test, watched it fail because the branch is unreachable.

## Acceptance

- `npx vitest run test/admin-release-name.test.ts` — 404 to a caller with no
  admin cookie, and the name stays held; the operator's press frees it, and a
  second press has nothing to act on.
- On a local checkout with `FERNSCOUT_ADMIN_EMAIL` set and a tombstone on disk:
  `/admin#instance` → Roster lists the name under "Deleted, name still held";
  Release asks with the name in the question; confirming leaves
  "…is free — anybody can sign up as it now" and the file is gone from
  `content/.deleted/`.
