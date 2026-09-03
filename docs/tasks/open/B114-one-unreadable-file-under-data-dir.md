---
id: B114
title: One unreadable file under DATA_DIR aborts the whole backup
type: ISSUE
priority: medium
complexity: low
area: backup, ops
found: "2026-09-01"
---

# B114 — One unreadable file under DATA_DIR aborts the whole backup

> Renumbered from **B78** on 2026-09-03. That id was already carried by the
> transport-styling task now in `testing/`; two sessions in parallel worktrees
> were handed it on the same afternoon. B99 is the fix.

## Why

Found on the live server on 2026-09-01, while setting the backup up for the
first time (B65) ahead of the restore drill (B21). Recorded in
`docs/archiv/runbook.md` §Restore drill, but never captured as work.

`scripts/backup.sh:78` stages `DATA_DIR` with a single `cp -a "$DATA_DIR/."`.
Under `set -euo pipefail`, one file the `fernscout` user cannot read — a
root-owned stray left by an operator, a socket, a file mid-rotation — makes
`cp` exit non-zero and stops the run. Nothing has been pushed at that point,
so the outcome is a night with no backup because of a file nobody needed.

`content/` at line 90 has the same shape.

B64 fixed the half of this that was about silence: the failure now mails an
operator and shows up in `/api/health` as `backup.state: "failing"`. Somebody
is told. But being told every morning that the backup did not run, because of
one file, is not the outcome anybody wants either — the remaining defect is
that a single unreadable byte anywhere can veto the whole thing.

The stakes are B21's: `content/` originals exist nowhere else.

## Work

Decide which of these is true, because they want different fixes:

- **Some files are legitimately unreadable and skippable** (sockets, lock
  files, a half-written temp file). Then `cp -a` is the wrong tool and the
  staging step should tolerate them, logging each skip as a `WARNING` and
  counting them — a run that skipped 400 files is not a successful backup even
  if restic exits 0.
- **Nothing under `DATA_DIR` should ever be unreadable.** Then the fix is to
  fail *early and by name* — check readability up front and say which file,
  rather than making the operator read a `cp` error out of the journal — and
  to say so in the runbook where the ownership rule already is.

Whichever: the failure must name the offending path. Today it does not.

Consider `restic backup` reading `DATA_DIR` directly instead of staging a copy,
which removes this step entirely — but that changes the snapshot's paths, which
the restore procedure and `test/backup-script.test.ts` both depend on
(`scripts/backup.sh:40–44` explains why the staging path is fixed). Not a
small change; not this task unless it is.

## Acceptance

- A `DATA_DIR` containing one unreadable file does not silently cost the whole
  night's backup, and whichever behaviour is chosen — skip or abort — names the
  file in the journal.
- Covered in `test/backup-script.test.ts`, which already runs the real script
  against a temp `DATA_DIR` (skip the case as root, the way the unwritable
  repository case does: `chmod` is advisory to root).
