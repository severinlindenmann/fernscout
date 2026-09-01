---
id: B64
title: A failed nightly backup tells nobody
type: ISSUE
priority: high
complexity: low
area: backup, ops
found: "2026-09-01"
started: "2026-09-01"
---

# B64 — A failed nightly backup tells nobody

## Why

`scripts/backup.sh` fails correctly. What happens next is the problem: nothing
happens.

`deploy/fernscout-backup.service` has no `OnFailure=`, and nothing in the app
knows a backup exists — `/api/health` reports capabilities, not the age of the
last snapshot. A failed run leaves the unit in `failed`, which is real, but a
person has to go and ask: `systemctl --failed`, `systemctl status
fernscout-backup`, `journalctl -u fernscout-backup`.

The command the documentation actually points at does not answer the question.
`deploy/fernscout-backup.timer:5` and `docs/archiv/runbook.md:391` both offer
`systemctl list-timers fernscout-backup`, which prints when the timer last
fired and when it will fire next — **not whether the run succeeded.** A person
following the runbook sees a healthy-looking timer while every night since
March has aborted.

Two things make the silence longer than it needs to be, found while writing
`test/backup-script.test.ts` for B21:

- **An unreachable repository stalls, quietly.** With `RESTIC_REPOSITORY`
  pointing at a host that refuses the connection, `restic snapshots` retries
  with exponential backoff; measured locally it was still going after 60
  seconds and had not yet given up. It does eventually exit non-zero and the
  script does fail — but `scripts/backup.sh:94` runs it as `restic snapshots
  >/dev/null 2>&1`, so the retry messages that would explain the delay are
  discarded. The journal shows the "staging" lines, then a long nothing.
  `TimeoutStartSec=30min` is the only bound.
- The backup is nightly, so the gap between a first failure and a person
  noticing is however long it takes somebody to think about backups.

The stakes are the ones B21 opens with: `content/` originals exist nowhere
else.

## Work

- `OnFailure=` on `fernscout-backup.service` pointing at a unit that sends
  something — the instance already has mail (`lib/mail.ts`), and the operator
  address is in `content/config.json`. A `status-mail@.service` template taking
  `%i` is the conventional shape.
- Consider writing a stamp file (`$DATA_DIR/.backup-last-success`, ISO-8601 on
  the way out of a successful run) and surfacing its age in `/api/health`, so
  "when did this last work" is answerable from the same place everything else
  about the deployment is answerable — and from off the box.
- Stop swallowing `restic snapshots` output at `scripts/backup.sh:94`, or at
  least log a line before it so a stalled run is legible in the journal.
- Fix the two places that recommend `systemctl list-timers` as the check:
  `systemctl status fernscout-backup` is the one that shows the last result.

## Acceptance

- A backup run that fails causes a notification a person receives without
  asking for it.
- The runbook's "is the backup working" instruction reports the last run's
  *result*, not just the next scheduled time.
- A run against an unreachable repository writes something to the journal
  before it starts waiting.
