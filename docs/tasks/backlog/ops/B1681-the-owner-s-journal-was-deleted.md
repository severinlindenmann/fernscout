---
id: B1681
title: The owner's journal was deleted from the live instance during an automated run
type: OPS
priority: high
complexity: low
area: ops
found: "2026-09-13T14:38:15Z"
---

# B1681 — The owner's journal was deleted from the live instance during an automated run

## Why

**`content/severin` — the owner's real journal, four trips — is no longer on
the live instance.** It was there at 16:21 UTC on 2026-09-13 and gone by
16:36, during a run in which several agents were working against the box at
once.

Before:

```
$ ssh … 'for d in /var/lib/fernscout/content/*/; do …; done'
example        trip.md=0 trip.json=8
severin        trip.md=4 trip.json=0
test-elena     trip.md=1 trip.json=0
test-jonas     trip.md=1 trip.json=0
test-margrit   trip.md=1 trip.json=0
test-mobile    trip.md=1 trip.json=0
test-v2-replay trip.md=0 trip.json=2
test-validator trip.md=0 trip.json=1
```

After:

```
$ ssh … 'ls -la /var/lib/fernscout/content/'
drwxrwxr-x 3 fernscout fernscout 4096 Sep 13 16:36 example
drwxr-xr-x 2 fernscout fernscout 4096 Sep 13 16:34 test-freshagent
```

`content/.deleted/` is gone too, so the tombstones that would have recorded a
legitimate deletion are absent — which is itself evidence this was not the
mail-gated delete flow but a filesystem removal.

**It is recoverable.** Last night's restic snapshot holds it whole:

```
$ ssh … 'restic ls 3c58ecc2 | grep -c "content/severin/"'
966
```

Snapshot `3c58ecc2`, 2026-09-13T03:30:20+02:00. `/api/health` reports both the
primary and the secondary repository healthy. `BACKUP_KEEP_DAILY` defaults to
14, so there is roughly a fortnight before `restic forget --prune` could take
it — no emergency, but not indefinite either.

The owner said the VPS is test data and may be cleared. `content/severin` is
not test data. Whoever removed it read a permission about throwaway journals
as covering the one real one.

## Work

**This is the owner's decision and nobody else's** — restoring republishes
their own content to a live public instance, and only they know whether the
removal was intended.

If they want it back:

```bash
ssh 95.216.112.173 'set -a; . /etc/fernscout/env; set +a; \
  restic restore 3c58ecc2 --target /var/tmp/restore-severin \
    --include "/var/tmp/fernscout-backup-staging/content/severin"'
# inspect, then:
ssh 95.216.112.173 'cp -a /var/tmp/restore-severin/var/tmp/fernscout-backup-staging/content/severin \
  /var/lib/fernscout/content/ && chown -R fernscout:fernscout /var/lib/fernscout/content/severin'
```

The same snapshot holds `content/.deleted/` and the other journals; restore
those separately, and only the ones wanted.

Note that the trips come back as `trip.md`, so B1680 — the journal being
unreadable under the v2 reader — is still owed afterwards. Restoring fixes
the loss, not the 404.

**Separately, and worth more than the restore:** nothing on the box stopped
this. A session with root can remove a journal with one command, and the
mail-gated delete flow an *agent* must use (B38) is not a wall around the
filesystem. Whether that should change is a question for the owner.

## Acceptance

- The owner has said whether they want the journal restored.
- If restored: `ls /var/lib/fernscout/content/severin/trips` lists four trips
  and `restic ls` and the box agree on the file count.
