---
id: B1706
title: A root-owned restic lock silently breaks the next nightly backup, and root restic runs leak RESTIC_PASSWORD into the journal
type: ISSUE
priority: high
complexity: low
area: Backups
found: "2026-09-14T08:05:37Z"
---

# B1706 — A root-owned restic lock silently breaks the next nightly backup, and root restic runs leak RESTIC_PASSWORD into the journal

## Why

`fernscout-backup.service` failed on the VPS at 2026-09-14T01:32:11Z:

```
ERROR: cannot read the repository at /var/backups/fernscout (restic exit 1)
ERROR: restic said: Load(<lock/7d4b51c5ac>, 0, 0) failed: open
  /var/backups/fernscout/locks/7d4b51c5ac… : permission denied
ERROR: this is not 'no repository yet', it is 'no answer' — refusing to run
  'restic init' over it.
```

The unit runs as `fernscout`. A lock file in `locks/` had been written by a
`restic` invoked as root, so `fernscout` could not read it, the repository read
failed wholesale, and the run aborted. The unit's own diagnostics named the
cause correctly — the script is not at fault. The lock was cleared by hand
before the 07:01 run, which succeeded, and nothing under `/var/backups/fernscout`
is non-`fernscout`-owned today. **One night was missed; backups are healthy now.**

Two things this exposed:

1. **Nothing stops the next one.** Any root `restic` against this repository
   leaves a root-owned lock and breaks the following night. The journal shows
   the careful form is already known (`sudo -u fernscout … --no-lock` at
   06:57), but nothing enforces it and nothing detects the wrong form after
   the fact — the next failure is again one missed night.

2. **The repository password went into the journal.** That 06:57 entry is:

   ```
   sudo[3100022]: root : PWD=/root ; USER=fernscout ;
     ENV=RESTIC_PASSWORD=<the real value> ; COMMAND=/usr/bin/restic …
   ```

   `sudo` logs its `ENV=` argument verbatim, so passing the password that way
   writes it into a journal that is retained, rotated and included in system
   log collection. AGENTS.md: secrets are environment-only and never enter logs.

## Work

Both halves are about how a person reaches this repository by hand, so the fix
is a documented-and-guarded path rather than a change to the backup script:

- Give the operator one wrapper for ad-hoc restic — reads `RESTIC_PASSWORD`
  from the env file rather than an argv/`ENV=` that `sudo` will log, and drops
  to `fernscout` so it cannot create a root-owned object. Point `vps` at it.
- Have the backup script's preflight say "a lock here is not owned by me" when
  that is the actual cause, rather than only listing it third among the usual
  causes.

Decide whether `RESTIC_PASSWORD` is rotated. The value is in the journal on
the box; whether that is a real exposure depends on who can read that journal.
**This is the owner's call, not an agent's.**

## Acceptance

- No path in the documented procedure puts a secret on a `sudo` command line.
- A root-owned lock left in the repository is reported by name on the next run.
