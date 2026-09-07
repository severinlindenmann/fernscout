---
id: B653
title: The backup set is everything under DATA_DIR minus what somebody remembered to subtract
type: CHORE
priority: high
complexity: medium
area: backup, DR, scripts/backup.sh
found: "2026-09-07T05:44:26Z"
started: "2026-09-07T05:48:16Z"
session: e5f23c58-bb87-4175-ad7b-5d3aed93169f
claimed: "2026-09-07T05:48:16Z"
---

# B653 — The backup set is everything under DATA_DIR minus what somebody remembered to subtract

## Why

**Design: `docs/plans/W42-what-a-backup-owes.md`.** Step 1 of its Order, and
the only step that stands alone.

`scripts/backup.sh` stages everything under `DATA_DIR`, then subtracts: `rm
-rf "$STAGING_DIR/data/mail"` is the whole subtraction (B636). A set defined
that way grows by default, and on this instance it has:

```
553M  content/                     the payload
296M  home/.npm + home/.cache      npm cache, nightly, forever
 93M  example-before-b325.tgz      an archive left behind in June
```

Forty per cent of a 915 MiB snapshot is build cache and a stray tarball.

Worse in the other direction: **`/etc/fernscout/env` has never been backed
up.** It sits outside `DATA_DIR`, so a restore returns every journal and
photograph and cannot start the service — no `DATABASE_URL`, no VAPID keys,
no SMTP credentials, no `FERNSCOUT_ADMIN_EMAIL`.

And it is why B651 happened: two root-owned `config.json.bak` files nobody
needed made two nights `partial` and fired the alert twice.

## Work

- Replace the subtractive set with an allowlist: `db/postgres.dump`,
  `content/`, `$DATA_DIR/config.json`, and `/etc/fernscout/env` staged as
  `env/fernscout.env`.
- **Strip `RESTIC_PASSWORD` from the staged env file.** A backup carrying the
  key to itself is no use to somebody holding only the backup, and widens the
  blast radius if the repository leaks. The runbook must then say where that
  one secret is kept — see B656.
- **Log every top-level entry under `DATA_DIR` that was not staged.** This is
  not decoration: the allowlist moves the failure mode from "junk silently
  included" to "something new silently excluded", and this line is the only
  thing that catches the second. Without it, do not ship the allowlist.
- Leave B114's partial-snapshot machinery exactly as it is for the paths the
  set claims. An unreadable `content/` is still a failure, and must be.
- Exclude generated output — `postcards/`, `photobooks/`, `mail/`. Orders are
  rows in Postgres and sources are in `content/`; what is lost is a PDF that
  can be produced again.
- The env file is `root:fernscout 0640`. Check the unit can read it, and say
  in the task what you found rather than widening the mode.

Not doing: anything about Proton, rclone or a second destination. B654 and
B655.

## Acceptance

- A run stages `content/`, the Postgres dump, `config.json` and the env file,
  and nothing else. The snapshot is around 555 MiB rather than 915 MiB.
- `env/fernscout.env` is present in a restored snapshot and contains no
  `RESTIC_PASSWORD`.
- The log names `home/` and `example-before-b325.tgz` as skipped.
- A root-owned unreadable file beside `config.json` does not make the run
  partial; an unreadable file under `content/` still does.
- `test/backup-script.test.ts` covers each of the four lines above.

## What was built, and what was found

**Layout.** `content/` is now staged at `content/` unconditionally — the
`is_inside()` nesting dance that used to skip a second stage when `CONTENT_DIR`
sat inside `DATA_DIR` (B444) is gone from the staging path entirely, because
`DATA_DIR` is no longer staged wholesale so there is nothing left to double up
against. `is_inside()` itself stays, repurposed as the one check the
skipped-entries log needs: without it, a nested `CONTENT_DIR` would show up as
a top-level `DATA_DIR` entry and get wrongly logged as "skipped" even though
step 2 just staged it as `content/`.

**RESTIC_PASSWORD stripped with `grep -v '^RESTIC_PASSWORD='`** — anchored on
the whole `KEY=` prefix, not a bare substring match. The env file is one
`KEY=value` per line (confirmed against `.env.example`'s shape); `grep -v`
therefore only ever drops lines that *are* that assignment, never a comment
that mentions the name, a neighbouring value that happens to contain the
string, or (there being no multi-line values anywhere in this file) a
continuation line. `AWS_SECRET_ACCESS_KEY` and the rest of the object-storage
credentials were considered as a second circular case — they too grant access
to the repository — and deliberately left in: they cannot *decrypt* a leaked
repository the way `RESTIC_PASSWORD` can, which is the specific blast-radius
argument W42 makes, and the design doc names only the one variable. Flagging
the distinction here rather than acting on it unasked.

**Generated output.** The ticket says excluding `postcards/`, `photobooks/`
and `mail/` "should require no code" — true for `mail/` (moved to `DATA_DIR`
by B636 and simply never in the allowlist) but not for the other two: both
live *nested inside* `content/<user>/`, not at a top level the allowlist could
skip for free. Staging `content/` wholesale therefore still copies them, so a
one-line `find … -exec rm -rf {} +` strips `content/<user>/postcards` and
`content/<user>/photobooks` back out after `stage_tree` has already run (same
shape as the pre-existing `data/mail` subtraction this replaces). Noted
because it contradicts the ticket's "no code" phrasing, not because the
outcome is in question.

**Env file permissions.** `root:fernscout 0640` with the unit's `User=fernscout
Group=fernscout` (`deploy/fernscout-backup.service`) is readable: 0640 grants
the owning group read, and the service's group is that file's group. No mode
change made or needed.

**Found and NOT fixed here, filed as B658**: on a deployment with no
`DATABASE_URL` (`docs/runbook.md:107`: "Leave `DATABASE_URL` unset for a
public-only site" — a supported shape, not a hypothetical one) or with
`DATABASE_URL=sqlite:…`, the app's own state — `reactions.json`,
`push-subscriptions.json`, and the sqlite file itself — lives only under
`DATA_DIR` and is not in this allowlist. It was backed up before, as part of
`DATA_DIR`; it is not now, and the only sign is a "skipped" line per file, per
night. This production instance runs Postgres and has none of the three, so
nothing here regresses for it — but the allowlist as specified does regress
the no-database/sqlite deployment shape the runbook documents as valid. Left
as a decision for a person rather than scope-crept into this ticket.

**Test changes.** The B114 partial-run tests moved their stray/locked fixtures
from `dataDir` to `contentDir`, because `stage_tree`'s tree-diff machinery now
only ever runs over `content/`. Added: a test that an unreadable file *beside*
`config.json` does **not** make the run partial (the literal B651 shape,
inverted); a test that the skipped-entries log names `home/`,
`example-before-b325.tgz`, `reactions.json`, `fernscout.db` and `mail/`, and
does not name `config.json`; a test that `postcards/`/`photobooks/` nested
under `content/<user>/` never reach a restored snapshot; and the former B444/
B401 nested-`CONTENT_DIR` tests were rewritten for the new layout (content
lands at `content/`, not `data/content`, and is not logged as skipped).

`npm run verify`: build, tsc, eslint (pre-existing warnings only, no new
ones), and all 4008 vitest tests green. `bash -n scripts/backup.sh` and
`shellcheck scripts/backup.sh` both clean.
