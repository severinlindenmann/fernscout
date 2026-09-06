---
id: B636
title: Sent mail is kept in the content folder, which is what gets backed up
type: CHORE
priority: medium
complexity: low
area: mail, content root, backup
found: "2026-09-06T17:51:47Z"
started: "2026-09-06T19:00:28Z"
merged: "2026-09-06T19:27:27Z"
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

## Done

New location: `<dataDir()>/mail/<username>/` (and `<dataDir()>/mail/.mail/`
for a signup code, which belongs to no journal yet) — `dataDir()` from
`lib/dataDir.ts`, not `contentRoot()`. `mailDir()` in `lib/mail/index.ts`
still refuses to write outside its root, now checked against the new one.

**Already-sent mail sitting at the old location:** chose "sweep both
locations for a while" over "an operator deletes it by hand" — the smaller
diff, since `sweepExpiredMail()` already existed and is generic over any
directory. `writeEml()` now also sweeps `contentRoot()/<user>/mail/` (or
`contentRoot()/.mail/`) on the same two-day TTL, guarded by an `existsSync`
so a fresh install never even asks the filesystem about a path it never
created. A deployment that keeps sending mail for a journal cleans up that
journal's leftovers within two days of the next send; a journal that never
sends again keeps whatever was already there — the same accepted limit the
sweep has always had for an inactive folder (see the `keepsCopy` doc comment
in `lib/mail/index.ts`), documented for an operator who wants it gone sooner
in `docs/deploy-mail.md`'s new "Upgrading from before B636" section.

**Backup:** mail moving under `DATA_DIR` would otherwise still land in every
snapshot, since `scripts/backup.sh` stages `DATA_DIR` wholesale. Added one
line — `rm -rf "$STAGING_DIR/data/mail"` — right after that stage, so the
directory is still staged (the sweep still owns it) and then dropped before
the push. `lib/exportZip.ts` never walked a mail directory in the first place
(it walks `trips/<id>` and `config.json` only), so the export acceptance was
already true and needed no change — verified with a fixture in
`test/backup-script.test.ts` that seeds `DATA_DIR/mail/alex/*.eml` and
asserts it is absent from the restored snapshot.

**Every reader updated**, beyond the writer: the ~20 test files across the
suite that located a journal's sent mail on disk (`deletions`, `day-mail`,
`credits-purchase`, `invite-links`, `journals`, `journals-required-fields`,
`buddy-mail-scope`, `contact-notify-mail-failure`, `contacts-admin-invite`,
`invite-preapproval`, `owner-self-details`, `photobook-receipt`, `payments`,
`alert-script`, `postcard-orders`, `mail`, `mail-journal-switch`,
`signup-mail`), plus `docs/deploy-mail.md`, `docs/running-locally.md`,
`docs/qa/BLACKBOX.md`, `docs/qa/SCENARIOS.md`, `docs/TESTING.md`, and
`AGENTS.md`'s content-model tree and B111 bullet. `.gitignore`'s
`content/*/mail/` and `content/.mail/` entries stay, now documented as
legacy-only (`.data/` already covers the new location).

**B111's rule** ("every path `lib/mail` can write to is under `contentRoot()`")
is exactly what this task changes; the enforcing test
(`test/mail.test.ts`: "every path the file transport can produce is under
the mail root") was rewritten to assert the new root instead of deleted, and
a new assertion in the same test proves it is *never* under `contentRoot()`
any more. `npm run verify` passes (build, tsc, lint, full vitest run).
