---
id: B1706
title: "A lock the service user cannot read fails the whole nightly backup, and only a person can clear it"
type: ISSUE
priority: high
complexity: low
area: Backups
found: "2026-09-14T08:05:37Z"
started: "2026-09-14T08:29:09Z"
merged: "2026-09-14T08:38:45Z"
completed: "2026-09-14T16:32:53Z"
---

# B1706 — A lock the service user cannot read fails the whole nightly backup, and only a person can clear it

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
`restic` invoked as root, `fernscout` could not read it, and the repository
probe failed wholesale. One night was missed; the lock was cleared by hand
before the 07:01 run, which succeeded, and nothing under
`/var/backups/fernscout` is misowned today.

**This is the same defect B1691 already fixed one half of.** B1691 taught
`backup.sh` to refuse to run as root, because `sudo ./scripts/backup.sh` leaves
a root-owned lock that refuses every later run. That guard holds. What it does
not cover is a bare `sudo restic` against the same repository — which is what
happened here, and which leaves exactly the same artifact.

So prevention is partial and recovery is absent: the script's own hint (line
~183) tells a person to run `sudo -u fernscout restic unlock`, but `unlock`
has to read each lock to judge it stale, so on the lock that actually caused
this it fails the same way the backup did. The remedy as documented does not
work on the case it is documented for.

A backup that needs a person before it will run again is not a backup. The run
can clear this itself: removing a file needs write permission on `locks/`,
which the service user has, not on the file.

## Work

In `scripts/backup.sh`, before the repository probe, sweep `locks/` for entries
this user cannot read, when `RESTIC_REPOSITORY` is a local directory:

- Untouched for 30 minutes or more — restic's own staleness threshold — remove
  it and log what was removed and why.
- Touched more recently: something may genuinely be holding it. Fail, naming
  the file, rather than stomping a live lock.
- `locks/` itself unreadable: fail naming that, since the sweep cannot see in.

Correct the hint at line ~183, which recommends a command that cannot work here.

Not in scope: the password `sudo` wrote into the journal — that is B1707, and
the owner has declined rotation.

## Acceptance

- A repository holding an unreadable stale lock backs up successfully, logging
  the removal, with no person involved.
- An unreadable lock younger than 30 minutes fails the run by name, and is
  still there afterwards.
- `npm run verify` passes; the new behaviour has a keeper in
  `test/backup-script-repository.test.ts`.
