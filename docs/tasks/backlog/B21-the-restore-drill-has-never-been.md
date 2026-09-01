---
id: B21
title: The restore drill has never been run on the stack that is deployed
type: CHORE
priority: high
complexity: medium
area: backup, ops
found: "2026-09-01"
---

# B21 — The restore drill, on the stack that is actually deployed

## Why

The backup mechanism is written and it is careful. `scripts/backup.sh` dumps
Postgres with `pg_dump -Fc` and **aborts rather than pushing a snapshot without
the dump** (line 63), stages `DATA_DIR` and `content/`, pushes to restic and
prunes to `BACKUP_KEEP_DAILY`. It runs nightly from
`deploy/fernscout-backup.timer`, and the staging directory is a fixed path
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

There is no automated coverage either: `grep -rl backup test/` matches only
`test/export.test.ts`, which is the journal export zip and a different thing.

What is at risk is somebody's journal — years of writing and the only copies
of photographs, since the originals are deliberately gitignored and
deliberately left out of the export (`lib/exportZip.ts:114`). "Just re-clone
the repo" recovers none of it, which is the reason `content/` is in the backup
at all despite being in git (`scripts/backup.sh:71–75`).

## Work

1. **Run the drill, on the native stack, and time it.** Seed known state:
   a reaction with a countable value, a push subscription, an uncommitted edit
   to a file under `content/`, and an original under
   `content/<user>/trips/<trip>/originals/` that is in neither git nor the
   export. Back up. Destroy. Restore by following
   `docs/archiv/runbook.md` §Restore procedure **exactly as written**, without
   improvising — where it has to be improvised, that is the finding.
2. Record what was actually run and how long it took, and tick the box. If a
   step was wrong, fix the runbook in the same change.
3. **Automate the part that can be.** A test that runs `backup.sh` against a
   temporary `DATA_DIR`, `CONTENT_DIR` and a local restic repository, then
   restores into a scratch directory and compares trees. `restic` supports a
   plain filesystem repository, so this needs no cloud account. That catches
   the staging-and-push half on every run; the Postgres half needs a database
   and belongs behind the same guard the other db tests use.
4. Check the failure paths while there: a `pg_dump` that fails must abort (it
   does — verify it), and a full or unreachable restic repository must exit
   non-zero so the systemd unit records a failure rather than a silent
   no-backup night. Confirm the timer surfaces that somewhere a person looks.

## Acceptance

- The checkbox at `docs/archiv/runbook.md:450` is ticked, with the date, the
  elapsed time and the stack it was run on.
- The seeded reaction count, the uncommitted `content/` edit and the original
  file all come back identical.
- A test restores a backup made by `scripts/backup.sh` and compares the tree,
  runnable with no network and no account.
- A backup run with a deliberately broken restic repository exits non-zero.
