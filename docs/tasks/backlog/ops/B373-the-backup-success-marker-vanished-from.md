---
id: B373
title: The backup success marker vanished from DATA_DIR between two deploys minutes apart
type: OPS
priority: high
complexity: low
area: backups, DATA_DIR, deploy health
found: "2026-09-04T21:16:00Z"
---

# B373 — The backup success marker vanished from DATA_DIR between two deploys minutes apart

## Why

Observed on fernscout.ch on 2026-09-04 during B365's deploy, not caused by it
— nothing in that change touches `DATA_DIR`.

Two `ship.sh` runs, roughly five minutes apart:

```
23:10  commit 34e2298dabd2   backup: ok (last success 2026-09-04T09:16:30.000Z)
23:15  commit 07de7063bd57   backup: unknown — no backup has ever recorded a
                             success in DATA_DIR
```

`journalctl -u fernscout-backup` shows the run completing normally:

```
[2026-09-04T09:16:30Z] 4 snapshot(s) tagged fernscout in this repository
[2026-09-04T09:16:30Z] recorded success in /var/lib/fernscout/.backup-last-success
```

The file is now absent:

```
$ sudo ls -la /var/lib/fernscout/.backup-last-success
ls: cannot access ...: No such file or directory
$ sudo ls -a /var/lib/fernscout/
.  ..  content  home
```

So the marker was written, was read successfully by one deploy, and was gone
by the next.

**Why this is `high` and not cosmetic.** B64 is the record of what silence
about backups costs, and `backupStatus` exists so a deploy states the answer
out loud every time. A marker that can disappear on its own makes that
statement unreliable in the direction that matters: it now says "unknown" when
backups are in fact fine, which is the fastest way to teach an operator to
ignore the line. The next real failure reads identically.

The second question is worse and is the reason for the priority: **something
removed a file from `DATA_DIR` while the service was running**, and nobody
knows what. `DATA_DIR` is the directory whose whole job is to survive
`git pull` and rebuilds. If the marker can go, the question of what else can
is open.

Note `/var/lib/fernscout/` holds only `content` and `home` — the database is
Postgres, so this is not evidence of wider loss, but it does mean the
directory has few enough entries that the absence is unambiguous.

## Work

- Find what deletes it. Candidates in order: a sibling agent session running a
  restore drill or a cleanup against the live box; `scripts/backup.sh`'s own
  prune path; a `tmpfiles.d` or systemd `PrivateTmp`/`StateDirectory=` rule
  that sweeps dotfiles in `StateDirectory`; the deploy's own content sync.
  `journalctl --since` around the window, and `auditctl -w` on the path if it
  is not obvious.
- Decide whether a marker file in `DATA_DIR` is the right home for this at
  all. The backup log is the durable record; the marker is a cache of its last
  line. Reading the unit's own last success (`systemctl show
  fernscout-backup -p ExecMainExitTimestamp` plus its status) would need no
  file.
- **Not** silencing the warning. It is currently telling the truth about its
  own knowledge.

## Acceptance

- The cause is named in this file, or ruled out with the command that ruled it
  out.
- Two consecutive deploys minutes apart report the same backup status.
