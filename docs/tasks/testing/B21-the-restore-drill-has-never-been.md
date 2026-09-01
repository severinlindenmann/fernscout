---
id: B21
title: The restore drill has never been run on the stack that is deployed
type: CHORE
priority: high
complexity: medium
area: backup, ops
found: "2026-09-01"
started: "2026-09-01"
merged: "2026-09-01"
---

# B21 — The restore drill, on the stack that is actually deployed

> **Status: half done, and the half that is left is the important one.**
> Items 3 and 4 — the local, automated coverage — landed in
> `test/backup-script.test.ts`. Items 1 and 2 — the destroy-and-restore drill
> against the deployed stack — have **not** been done and were deliberately
> kept out of an autonomous agent's hands: they mean destroying live state on
> the deployed VPS and putting it back, and an agent that gets step 4 wrong has
> deleted somebody's journal to prove it could restore it. That is a person's
> job, at a keyboard, watching. See "What is still open" below for what is left
> and what the automated half already tells you before you start.

## Why

The backup mechanism is written and it is careful. `scripts/backup.sh` dumps
Postgres with `pg_dump -Fc` and **aborts rather than pushing a snapshot without
the dump** (line 63 — verified, see Findings), stages `DATA_DIR` and
`content/`, pushes to restic and prunes to `BACKUP_KEEP_DAILY`. It runs nightly
from `deploy/fernscout-backup.timer`, and the staging directory is a fixed path
rather than `mktemp` specifically so `restic restore latest --target /restore`
lands somewhere predictable (`scripts/backup.sh:40–44`).

The restore has never been performed against this deployment. The runbook says
so itself, in an unchecked box at `docs/archiv/runbook.md:450`:

> - [ ] **Re-run the drill on the native stack before relying on it.** The
>       procedure above is derived, not yet executed end to end. A backup you
>       have not restored from is not a backup, and a *procedure* you have not
>       followed is not a procedure.

The drill that *was* run — 46 seconds, rows exact, files byte-identical — was
against the previous containerised layout. What changed is where `pg_dump`
runs, from inside a container to the host, which is exactly the kind of change
that turns a working procedure into a broken one without touching the parts
that get tested.

There was no automated coverage either: `grep -rl backup test/` matched only
`test/export.test.ts`, which is the journal export zip and a different thing.
There is now — `test/backup-script.test.ts` — and it does not replace the
drill.

What is at risk is somebody's journal — years of writing and the only copies
of photographs, since the originals are deliberately gitignored and
deliberately left out of the export (`lib/exportZip.ts:114`). "Just re-clone
the repo" recovers none of it, which is the reason `content/` is in the backup
at all despite being in git (`scripts/backup.sh:71–75`).

## Work

1. **Run the drill, on the native stack, and time it.** — **NOT DONE.** Seed
   known state: a reaction with a countable value, a push subscription, an
   uncommitted edit to a file under `content/`, and an original under
   `content/<user>/trips/<trip>/originals/` that is in neither git nor the
   export. Back up. Destroy. Restore by following `docs/archiv/runbook.md`
   §Restore procedure **exactly as written**, without improvising — where it
   has to be improvised, that is the finding.
2. Record what was actually run and how long it took, and tick the box. If a
   step was wrong, fix the runbook in the same change. — **NOT DONE.** The box
   at `docs/archiv/runbook.md:450` is still unticked, on purpose: it asks
   whether the drill was run *on the deployed stack*, and nothing local can
   answer that. Ticking it on the strength of the test below would be exactly
   the false record this task exists to prevent.
3. **Automate the part that can be.** — **DONE**, `test/backup-script.test.ts`.
   Runs `scripts/backup.sh` against a temporary `DATA_DIR`, `CONTENT_DIR` and a
   **local filesystem restic repository**, restores the snapshot into a scratch
   directory and compares the trees by sha256, file by file. No network, no
   cloud account, no VPS. The whole file skips — loudly, via `console.warn` —
   when `restic` is not installed, rather than passing vacuously. The Postgres
   half is behind `POSTGRES_TEST_URL`, the same guard `test/db-*.test.ts` use;
   the script's *Postgres branch* is covered without a database by stubbing
   `pg_dump` on `PATH`.
4. **Check the failure paths.** — **DONE**, and they are in the same file. See
   Findings: the `pg_dump` abort is real, a broken repository does exit
   non-zero, and the answer to "does the timer surface a failure somewhere a
   person looks" turned out to be *no* — captured as **B64**.

## Findings

Everything below was run on a laptop against temporary directories and a local
filesystem restic repository (restic 0.19.1). Nothing was run against the
deployment.

**`scripts/backup.sh:62–65` does abort, as the Why claimed.** A failing
`pg_dump` — both the real thing absent from `PATH`, and a stub that exits 1 —
logs `ERROR: pg_dump failed — aborting before pushing a backup without a DB
dump`, exits 1, and never reaches `restic backup`. Asserted against a
repository that already holds a snapshot, so "no new snapshot" means something.
Removing the `exit 1` makes the test fail.

**A broken repository exits non-zero.** An unwritable repository path fails in
about a tenth of a second with `Fatal: create repository … permission denied`
and exit 1; an existing repository opened with the wrong password fails in
about half a second (`restic snapshots` fails, the script tries `restic init`,
which refuses with `config file already exists`, and `set -e` does the rest).
Both are the behaviour the acceptance criterion asks for.

**But "unreachable" is not the same as "broken", and it is not fast.** Pointed
at a host that refuses the connection, `restic snapshots` retries with
exponential backoff — still running after 60 seconds, first retry scheduled
65 seconds out. It does eventually fail and the script does exit non-zero, so
systemd records a failure; but `scripts/backup.sh:94` runs it as `restic
snapshots >/dev/null 2>&1`, so nothing explains the stall in the journal, and
`TimeoutStartSec=30min` is the only bound. Captured as **B64**.

**The timer does not surface a failure where the documentation points.**
`deploy/fernscout-backup.service` has no `OnFailure=`; nothing mails, and
`/api/health` knows nothing about backups. A failure *is* visible — the unit
sits in `failed`, so `systemctl --failed`, `systemctl status fernscout-backup`
and `journalctl -u fernscout-backup` all show it — but the check both
`deploy/fernscout-backup.timer:5` and `docs/archiv/runbook.md:391` recommend is
`systemctl list-timers fernscout-backup`, which reports when the timer fired
and will fire again, **not whether the run succeeded**. Captured as **B64**.

**A wrong `RESTIC_REPOSITORY` is a silent success, not a failure.** Because
`scripts/backup.sh:94–97` cannot tell "not initialised yet" from "not the
repository you meant", pointing it at a path that does not exist creates a new
empty repository, backs up into it, prunes it, and exits 0. Captured as
**B63**.

**The runbook's restore path is right.** Step 2 —
`find /restore -maxdepth 4 -type d -name 'fernscout-backup-staging'` — works
because restic really does store the staging directory's absolute path inside
the snapshot; the test finds the staged tree the same way rather than assuming
the layout. `restic restore latest --target …` is still current syntax in
0.19.1. `/var/tmp/fernscout-backup-staging` restores to depth 3, so
`-maxdepth 4` has room.

**The `EXIT` trap does clean up.** The staging directory is gone after both a
successful and a failed run, which matters because the next run's `rm -rf
"$STAGING_DIR"` on a fixed path is otherwise operating blind.

## What is still open

For whoever runs the drill: the automated half already tells you that the
script stages and restores correctly and that its `pg_dump` guard is real. What
it cannot tell you is anything about the *deployed* stack — that `pg_dump` on
the host reaches the right database, that `pg_restore --clean --if-exists`
against a live `DATABASE_URL` does what the runbook says, that
`/var/lib/fernscout` and `/srv/fernscout/content` come back with the right
ownership, or that the service starts afterwards. Those are items 1 and 2, and
they need a person on the box.

Note before starting: `restic restore latest --target /restore` writes the
snapshot's full absolute path under `/restore`, so budget the disk for a second
copy of `content/`.

## Acceptance

- [ ] The checkbox at `docs/archiv/runbook.md:450` is ticked, with the date,
      the elapsed time and the stack it was run on.
      — **OUTSTANDING.** Needs the drill on the deployed stack (items 1–2).
- [ ] The seeded reaction count, the uncommitted `content/` edit and the
      original file all come back identical.
      — **OUTSTANDING** *as written*: this line is about the deployed stack.
      The equivalent against a temporary directory is covered by
      `test/backup-script.test.ts` ("backs up DATA_DIR and content/, and
      restores them byte-identical"), which seeds a reaction count of 7, an
      uncommitted `trip.md` edit and a 64 KiB `originals/DSCF1234.RAF`, and
      compares every file by sha256. That is not the same claim.
- [x] A test restores a backup made by `scripts/backup.sh` and compares the
      tree, runnable with no network and no account.
      — **DONE.** `test/backup-script.test.ts`; `npx vitest run
      test/backup-script.test.ts` → 5 passed, 1 skipped (the real-Postgres
      case, absent `POSTGRES_TEST_URL`).
- [x] A backup run with a deliberately broken restic repository exits non-zero.
      — **DONE.** "an unwritable restic repository exits non-zero, so systemd
      records a failure"; skipped as root, where `chmod` is advisory, the same
      way `test/migrate-owner.test.ts` skips its permission case.

## Related

- **B64** — a failed nightly backup tells nobody (no `OnFailure=`, and the
  documented check reports the schedule rather than the result).
- **B63** — a wrong `RESTIC_REPOSITORY` silently becomes a new empty repository.
- **B65** — captured by a parallel session while this was in flight, and not
  verified from here: it reports that the deployed server has no backup
  installed at all. If that holds, it comes before items 1–2 — there is nothing
  to restore *from* until it is fixed, and "the drill has never been run" is
  then the smaller half of the problem.
