---
id: B114
title: One unreadable file under DATA_DIR aborts the whole backup
type: ISSUE
priority: medium
complexity: low
area: backup, ops
found: "2026-09-01"
started: "2026-09-03"
merged: "2026-09-03"
---

# B114 — One unreadable file under DATA_DIR aborts the whole backup

> Renumbered from **B78** on 2026-09-03. That id was already carried by the
> transport-styling task now in `testing/`; two sessions in parallel worktrees
> were handed it on the same afternoon. B99 is the fix.

## Why

Found on the live server on 2026-09-01, while setting the backup up for the
first time (B65) ahead of the restore drill (B21). Recorded in
`docs/archiv/runbook.md` §Restore drill, but never captured as work.

`scripts/backup.sh` staged `DATA_DIR` with a single `cp -a "$DATA_DIR/."`
(line 90 as the file stood on 2026-09-03 — the Why said line 78, which was
right when this was captured and had drifted by twelve lines since B63 and
B64 landed; `content/` was line 103, not 90). Under `set -euo pipefail`, one
file the `fernscout` user cannot read — a root-owned stray left by an
operator, a socket, a file mid-rotation — made `cp` exit non-zero and stopped
the run. Nothing had been pushed at that point, so the outcome was a night
with no backup because of a file nobody needed.

`content/` had the same shape.

B64 fixed the half of this that was about silence: the failure now mails an
operator and shows up in `/api/health` as `backup.state: "failing"`. Somebody
is told. But being told every morning that the backup did not run, because of
one file, is not the outcome anybody wants either — the remaining defect is
that a single unreadable byte anywhere can veto the whole thing.

The stakes are B21's: `content/` originals exist nowhere else.

Everything above still held when the work started; nothing in the Why turned
out to be wrong beyond the two line numbers.

## Work

**Done.** The judgement call the two bullets below asked for was made in favour
of the first — with the second's *verdict* kept.

- **Some files are legitimately unreadable and skippable** (sockets, lock
  files, a half-written temp file). Then `cp -a` is the wrong tool and the
  staging step should tolerate them, logging each skip as a `WARNING` and
  counting them — a run that skipped 400 files is not a successful backup even
  if restic exits 0.
- **Nothing under `DATA_DIR` should ever be unreadable.** Then the fix is to
  fail *early and by name* — check readability up front and say which file,
  rather than making the operator read a `cp` error out of the journal — and
  to say so in the runbook where the ownership rule already is.

### Which, and why

**Chosen: tolerate and stage, name and count — and never record such a run as
a success.** Both of the above are true at once, and they are answering
different questions. "Is this file worth the night's backup?" is answered by
the first: no, never — the journal's originals exist nowhere else and losing
all of them to one stray file is strictly the worse of the two failures.
"Should anybody have to live with it?" is answered by the second: no — what is
under `DATA_DIR` is the app's own state plus `content/`, all of it owned by the
service user, so anything unreadable there is an operator error somebody has to
go and fix.

Failing *early* was rejected outright: it has exactly the same outcome as the
bug being fixed — no snapshot tonight, for the same trivial cause — only
sooner. So a run that hits an unreadable path now:

1. **keeps staging.** `cp` already copies what it can, reports the rest on
   stderr and exits non-zero; that status is tolerated instead of fatal.
2. **names every path it could not take**, absolute, in the journal — capped
   at 25 lines with an "… and N more" tail, and cp's own message kept above
   them because it says *why*.
3. **pushes the snapshot anyway**, tagged `partial` as well as `fernscout`, so
   `restic snapshots` answers "was that night complete?" years later without
   the journal to hand.
4. **still exits non-zero.** No `.backup-last-success` stamp, so the
   `OnFailure=` alert fires and `/api/health` reports `backup.state:
   "failing"`. Skipping is tolerated; being told it was fine is not. This is
   the second bullet's verdict, moved from before the copy to after it.

Two nets find what was missed, because neither is enough alone. A readability
scan (`find … ! -exec test -r {} \;`, not GNU's `-readable`, which BSD find on
the test machine does not have) catches an unreadable **directory** — `cp`
creates it empty at the destination, so a tree comparison sees it in both trees
and nothing looks wrong. A before/after inventory diff catches everything else
that failed to copy — a socket, a device node, a full disk — without anybody
parsing cp's platform-specific wording. Both only run when `cp` reported a
failure, so a clean night costs one extra directory walk and nothing else.

**Not done, deliberately:** `restic backup` reading `DATA_DIR` directly instead
of staging a copy. It would delete this problem rather than manage it, but it
changes the snapshot's paths, and the restore procedure in
`docs/archiv/runbook.md`, the `--target /restore` behaviour explained at
`scripts/backup.sh:54-58`, and `restoreLatest()` in
`test/backup-script.test.ts` all depend on the staging path being fixed. That
is its own task, with its own restore drill, and not this one.

**Also not done:** the stale `docs/runbook.md` links in `scripts/backup.sh`
(the file is at `docs/archiv/runbook.md`). Already captured — see B62.

### What changed

- `scripts/backup.sh` — `stage_tree()`, plus `list_tree()` and
  `unreadable_paths()`; both staging steps call it; the `partial` tag on the
  push; the `SKIPPED_TOTAL` gate before the success stamp. One more guard: `cp`
  can leave an unreadable *directory* in the staging copy, which the EXIT
  trap's `rm -rf` and then tomorrow's would trip over, so directories in the
  staged tree are made traversable on that path only.
- `test/backup-script.test.ts` — three cases, all skipped as root because
  `chmod` is advisory there: an unreadable file, an unreadable directory, and
  the operator's fix turning the next run green again.
- `docs/archiv/runbook.md` — §Backups gains the log excerpt, what the two
  outcomes mean and the `chown` that fixes it, next to the ownership rule it
  belongs with; the §Restore drill bullet that said this fragility was
  unfixed no longer says so.

## Acceptance

- A `DATA_DIR` containing one unreadable file does not silently cost the whole
  night's backup, and whichever behaviour is chosen — skip or abort — names the
  file in the journal.
- Covered in `test/backup-script.test.ts`, which already runs the real script
  against a temp `DATA_DIR` (skip the case as root, the way the unwritable
  repository case does: `chmod` is advisory to root).
