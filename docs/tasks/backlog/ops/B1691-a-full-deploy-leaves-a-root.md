---
id: B1691
title: A full deploy leaves a root-owned restic lock, so every later nightly backup is refused
type: OPS
priority: high
complexity: low
area: vps, backup
found: "2026-09-14T05:03:00Z"
---

# B1691 — A full deploy leaves a root-owned restic lock, so every later nightly backup is refused

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`scripts/deploy.sh` runs under `sudo`, and step 0 of the deploy reaches the
restic repository (the nightly rates refresh hangs off `scripts/backup.sh`).
Restic locks are owned by whoever creates them, so a deploy leaves:

```
-r-------- 1 root root  .../var/backups/fernscout/locks/<hash>
```

`fernscout-backup.service` runs `User=fernscout`. It cannot write into a
locks directory holding a root-owned entry, so **every nightly backup after a
full deploy is refused** with `unable to create lock in backend: permission
denied`.

Observed 2026-09-13/14: a `ship.sh --full` at 16:37 left such a lock; the
03:31 backup failed — the first failure in a run of nightly successes going
back to 10 September. The repository and all 15 snapshots were unharmed, and
a manual run succeeded immediately once the stale lock was removed.

**Why it matters more than the fix's size.** The failure is silent unless
somebody reads `/api/health`'s `backup` line, and it leaves the instance
without a fresh backup precisely after a deploy — the moment something is most
likely to have gone wrong. Here it went unnoticed for 27 hours, immediately
after the content directory had been wiped to a clean slate.

The script itself behaved well: it refused to `restic init` over a repository
it could not read, saying *"this is not 'no repository yet', it is 'no
answer'"*, and named the three usual causes in order. That refusal is why no
damage was done.

## Work

Stop the deploy creating root-owned locks. In rough order of preference:

- Run the restic-touching step as the service user (`sudo -u fernscout`), so
  every lock in that repository has one owner.
- Or release the lock explicitly when that step finishes, rather than relying
  on the process exiting cleanly.
- Or drop the repository read from the deploy path entirely, if the rates
  refresh does not genuinely need it.

Whichever: a stale lock left by a crashed run must not need a person to find
it. `restic unlock` exists for this — but a guard that only works when
somebody already suspects the problem is not a guard.

## Acceptance

A full deploy, followed by a nightly backup, with no manual step in between
and no root-owned file anywhere under `/var/backups/fernscout`. `/api/health`
reports the backup healthy afterwards.
