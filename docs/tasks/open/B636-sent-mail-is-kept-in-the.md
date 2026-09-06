---
id: B636
title: Sent mail is kept in the content folder, which is what gets backed up
type: CHORE
priority: medium
complexity: low
area: mail, content root, backup
found: "2026-09-06T17:51:47Z"
---

# B636 — Sent mail is kept in the content folder, which is what gets backed up

## Why

Every mail this instance sends leaves a `.eml` under `content/<user>/mail/`
(`mailDir()`, `lib/mail/index.ts:93`). `content/` is the folder the owner owns
and the folder that gets backed up and exported — it is meant to hold the
journal, and sent mail is not the journal. It is also plaintext, as the note at
`lib/mail/index.ts:514` says, so a backup of somebody's journal carries their
sign-in codes and invitation links.

There is already a sweep (two days, `lib/mail/index.ts:176`), so the intent was
never to keep them; the location is what is wrong.

## Work

- Move sent mail out of `content/` to somewhere transient — the data dir is the
  candidate (`lib/dataDir.ts`), and it must still be a path the sweep owns.
- `content/.mail/` — mail belonging to no journal — moves for the same reason.
- The refusal at `lib/mail/index.ts:107` guards the content root; it must guard
  the new root just as tightly, and B111's rule stands: nothing lands next to
  the code.
- Backup and export must stop including mail. Check `lib/exportZip.ts` and the
  backup script actually see the change.
- `AGENTS.md` describes both paths in the content-model tree. Correct it.

## Acceptance

- Sending mail with the file backend writes outside `content/`, and the sweep
  still removes it.
- A journal export and a backup contain no `.eml`.
- `npm run verify` passes, and `AGENTS.md` no longer points at the old paths.
