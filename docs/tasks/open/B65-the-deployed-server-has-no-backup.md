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


## Amendment, 2026-09-03 — the title is now half wrong

Checked on the live server while verifying B21, B63 and B64. **The installation
half of this task has since been done.** Anyone picking it up should not go
looking for the absence it describes:

- `restic 0.18.0` at `/usr/bin/restic`.
- `fernscout-backup.service` and `fernscout-backup.timer` are installed and the
  timer is enabled; next elapse Fri 2026-09-04 03:26:49 CEST.
- The repository at `/var/backups/fernscout` is real and populated — `config`,
  `data/` (258 dirs), `index`, `keys`, `locks`, `snapshots/` — 307 MB, owned by
  `fernscout`, holding three snapshots dated 09-01, 09-02 and 09-03. The
  2026-09-03 03:36 run succeeded: snapshot `548c2a4c`, 4457 files, 486 MiB.

**What remains true is this file's second point, and it is the important one.**
`df -h /var/backups /var/lib/fernscout /srv` returns `/dev/md2` for all three:
one filesystem, one machine. There is no copy of anything off this host. The
bullet already in this task — *"a path on the same machine … protects against a
bad deploy or an accidental deletion, but not against losing the machine, which
is the case a backup is usually for"* — is exactly right and is still
unactioned.

One thing to fold in while doing it: `scripts/backup.sh:3` describes the backup
as *"pushed off-VPS with restic"* and its example at `:22` is an S3 URL. On this
deployment neither is true, so the script's own header misdescribes what it
does — which is how somebody comes to believe there is an off-site copy.

Retitling this task would help: what is left is not "no backup at all" but "the
backup is on the machine it protects".

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
