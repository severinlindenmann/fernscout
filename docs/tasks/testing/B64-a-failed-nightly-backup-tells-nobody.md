---
id: B64
title: A failed nightly backup tells nobody
type: ISSUE
priority: high
complexity: low
area: backup, ops
found: "2026-09-01"
started: "2026-09-01"
merged: "2026-09-01"
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

### It happened, on 2026-09-01

Written from inference; confirmed the same night by the restore drill (B21) on
the live server. `scripts/backup.sh` **failed three times in a row**, and the
only reason anybody knew is that a person was watching `journalctl` at the
time. Nothing mailed, nothing degraded, `/api/health` knew nothing. The three
failures were B63's probe (a root-owned repository read as "not initialised"),
and before that a `ReadWritePaths=` violation that stopped the unit before
`backup.sh` ran at all.

Also worth recording, because it changes what "the timer is fine" is worth:
until that night the server had **no backups at all** — no restic, no units, no
credentials (B65). Nothing anywhere said so, for months. So `unknown` — the
state an instance with nothing installed reports — has to be a state this fix
can express, not an omission.

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

## What was built, and what was left out

All four candidates above were needed in the end, but not equally, and they do
different jobs. In descending order of how much of the problem each solves:

**1. A last-success stamp, surfaced in `/api/health` (`lib/backupStatus.ts`).**
The one that answers "are backups working?" from outside the box, which nothing
could do before — and the only one that catches *absence* rather than failure.
An instance where the timer was never installed reports `state: "unknown"`,
which is what B65 was for months with nothing anywhere saying so. Four states:
`ok`, `stale` (nothing succeeded within `BACKUP_MAX_AGE_HOURS`, 36 by default —
one missed nightly run is inside the window, two is not), `failing` (a run
failed since the last success — this outranks the age check, so "ok, because
Tuesday worked" cannot happen), `unknown`.

Deliberately **not** folded into the endpoint's status code. A stale backup is
a reason to page somebody and not a reason to take the instance out of a load
balancer or fail `scripts/deploy.sh`, which polls exactly this endpoint. It is
a top-level `.backup` key an uptime monitor asserts on instead.

Also deliberately not a capability: capabilities are absent when off, and a
backup that is absent is precisely the thing that must still be reported.

**2. `OnFailure=` → `deploy/fernscout-alert@.service` → `scripts/alert.sh`.**
The only channel that reaches somebody who is not looking. Two independent
things happen in it, because either can be unavailable alone: a stamp file
(`$DATA_DIR/.backup-last-failure`, pure shell, no node, no network, works with
mail switched off — which is every instance by default) and mail to the
operator through the app's own transport (`npm run alert`, `scripts/alert.mts`,
recipient from `BACKUP_ALERT_EMAIL` or the default journal's `owner.email`).
The handler is generic — `%n` passes whatever unit failed — but it writes the
*backup* stamp only for the backup unit, since a worker failure recorded there
would be a false alarm about the one thing this mechanism has to be trusted on.
If neither channel worked, `alert.sh` fails itself, so `systemctl --failed`
still has something to say.

**3. Stop swallowing the `restic snapshots` probe.** Reduced in scope on
purpose. The stall is announced *before* the call rather than explained after
it — a line after a call that hangs for minutes is a line nobody reads in time
— and the probe's stderr is captured and logged instead of discarded. The
probe's actual defect, that it cannot tell "absent" from "unreachable", is
**B63** and is fixed there; this task only stopped it being invisible.

**4. The two `list-timers` recommendations**, in `deploy/fernscout-backup.timer`
and `docs/archiv/runbook.md`, plus the same line in `scripts/backup.sh`'s own
header. All three now name `systemctl status` for the last *result* and keep
`list-timers` for the schedule, which is the only thing it reports.

One thing added beyond the four: `scripts/deploy.sh` prints the backup state on
every deploy (never fatally). It is the command this deployment's operator
actually runs, and the failure mode here is by definition one nobody went
looking for.

**Found while building, captured not absorbed:** B114 — one unreadable file
anywhere under `DATA_DIR` makes `cp -a` fail and costs the whole night's
backup. B64 fixes the half of that which was about silence; the veto itself is
still there.

**A consequence worth knowing:** the stamp lives in `DATA_DIR` and is written
*after* the snapshot, so every snapshot carries the previous run's stamp and a
restored instance reports its second-to-last backup. One night stale and honest
beats a restored instance claiming a backup it cannot have taken.
`test/backup-script.test.ts` skips the stamps in its byte-for-byte comparison
for this reason, and says so.

## Acceptance

- A backup run that fails causes a notification a person receives without
  asking for it.
- The runbook's "is the backup working" instruction reports the last run's
  *result*, not just the next scheduled time.
- A run against an unreachable repository writes something to the journal
  before it starts waiting.

### Evidence

- **Notification.** `deploy/fernscout-backup.service` carries
  `OnFailure=fernscout-alert@%n.service`; `deploy/fernscout-alert@.service`
  runs `scripts/alert.sh %i`. `test/alert-script.test.ts` sends the alert for
  real through the file transport and asserts the resulting `.eml` names the
  unit, the piped journal detail and the two commands to run —
  `npm run alert` is proven to produce a message, not to intend one.
  `test/backup-script.test.ts` covers the channel that needs nothing at all:
  `scripts/alert.sh` with no systemctl, no journalctl and no app still writes
  `.backup-last-failure`, and exits non-zero when neither channel worked.
- **Result, not schedule.** `docs/archiv/runbook.md` §Backups has a new
  "Is the backup working?" section that opens "Not `systemctl list-timers`"
  and gives three commands that do answer it. The same correction is in
  `deploy/fernscout-backup.timer` and `scripts/backup.sh`'s header.
  `test/backup-status.test.ts` pins the `/api/health` `.backup` block, including
  that a stale backup does not change the status code.
- **A journal line before the wait.** `scripts/backup.sh` logs
  "checking the repository at … (first call to reach it — a long pause here
  means it cannot be)" before the probe, and logs the probe's captured stderr
  on failure. `test/backup-script.test.ts` asserts that line appears *before*
  "backing up to" in the run's output.
