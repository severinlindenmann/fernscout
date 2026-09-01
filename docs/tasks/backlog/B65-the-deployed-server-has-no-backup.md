---
id: B65
title: The deployed server has no backup at all — restic, the units and the credentials were never installed
type: CHORE
priority: high
complexity: medium
area: backup, ops, deploy
found: "2026-09-01"
---

# B65 — The deployed server has no backup at all

## Why

B21 says the backup *"runs nightly from `deploy/fernscout-backup.timer`"* and
that what is missing is a restore drill. Checking the server before running
that drill, none of it was there:

```
/etc/systemd/system/   fernscout.service only — no fernscout-backup.service, no .timer
systemctl list-timers  no fernscout timer
which restic           not installed
/etc/fernscout/env     # RESTIC_REPOSITORY  and  # RESTIC_PASSWORD, both commented out
```

So the gap is one step earlier than B21 describes: the backup has never been
*set up*, not merely never restored from. `scripts/backup.sh` is written and
careful and has never run on this machine.

At the time of writing the server holds 98 MB across three journals, including
two `originals/` directories — twelve photographs that are in neither git nor
the export (`lib/exportZip.ts` omits originals deliberately), so "re-clone the
repo" recovers nothing of them.

**The author's position, recorded so nobody re-raises it as an emergency: the
content currently on that server is test data and its loss does not matter.**
That is why this is `CHORE` rather than `SECURITY`, and why the drill was run
without first solving it. It stops being true the moment a real journal lands
there, and journal deletion (B38) is already live and irreversible.

## Work

- Install `restic` and the two units, and set `RESTIC_REPOSITORY` /
  `RESTIC_PASSWORD` in `/etc/fernscout/env`. The runbook §Backups has the
  commands; following them is most of this task.
- Decide where the repository lives. A path on the same machine satisfies
  `backup.sh` and protects against a bad deploy or an accidental deletion —
  but not against losing the machine, which is the case a backup is usually
  for. An off-box target is the real answer.
- `RESTIC_PASSWORD` is unrecoverable by design; the runbook already says to
  store it somewhere that is not this machine. Whoever does this has to
  actually do that.
- Make the absence detectable. Nothing failed, warned or degraded while there
  were no backups at all — that is the part worth fixing beyond this instance.
  `/api/health` knowing when the last successful backup was, or the deploy
  refusing to be quiet about a missing timer, would each have caught it.

## Acceptance

- `systemctl list-timers fernscout-backup` shows a scheduled run.
- `sudo systemctl start fernscout-backup` completes and `restic snapshots`
  lists the snapshot, with the database dump, `DATA_DIR` and `content/` in it.
- Something a person or a machine looks at reports when the last successful
  backup was, so a silent absence cannot recur.
- The repository location and the fact that the password is stored off-machine
  are both written down in the runbook.
