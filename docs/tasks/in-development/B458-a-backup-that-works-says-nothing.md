---
id: B458
title: A backup that works says nothing, so the only evidence the alarm is alive is an alarm
type: FEATURE
priority: medium
complexity: low
area: backups
found: "2026-09-05T12:52:31Z"
started: "2026-09-05T12:52:53Z"
session: 7c3dd4ae-2d91-4172-8ea8-52deb35f9f42
claimed: "2026-09-05T12:52:53Z"
---

# B458 — A backup that works says nothing, so the only evidence the alarm is alive is an alarm

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Asked for directly: *"can you send the same email with success if all good"*.

Today `deploy/fernscout-backup.service` carries `OnFailure=` and nothing else,
so mail arrives only when something breaks. Two consequences, and the second is
the one that motivated B64 in the first place:

- A quiet mailbox is indistinguishable from a mailbox whose sender is broken.
  `scripts/alert.sh` failing silently, mail credentials expiring, the unit's
  `OnFailure=` not installed — every one of those looks exactly like a month of
  good backups.
- The morning after an incident, the question is *"did last night's run
  finish"*, and the answer currently lives in `journalctl` or `/api/health`.
  A person reading their phone has neither.

The alarm was untrustworthy once already for precisely this reason: B138 is the
record of `fernscout-alert@.service` never being copied to the server, which
nobody noticed for two days because a working alarm and an absent one send the
same number of messages.

## Work

`systemd` 257 on the VPS, so `OnSuccess=` is available (249+).

`scripts/alert.sh` already asks systemd for `Result` and `ExecMainStatus` — it
just ignores them except to decorate the summary. Branch on them instead, so
one script and one template unit serve both outcomes:

- **Unknown is a failure.** `systemctl` absent, or the properties empty, must
  read as failure and never as success. An alarm that reports success when it
  cannot tell is worse than one that cries wolf.
- **Do not write `.backup-last-failure` on a success.** `scripts/backup.sh`
  writes `.backup-last-success` itself; the alert script's stamp is for the
  failure path only, and a success stamp written from here would be a second
  writer of a fact that already has one.
- `scripts/alert.mts` needs the subject, the opening line and the closing
  "Sent by … OnFailure=" to follow the outcome.
- `OnSuccess=fernscout-alert@%n.service` on the backup unit, beside the
  existing `OnFailure=`, in `[Unit]` — a copy in `[Service]` is silently
  ignored, which is the trap `deploy/fernscout-backup.service:13` already
  documents for `OnFailure=`.

Not doing: a digest, a quiet-hours window, or a switch to turn the success mail
off. One mail a night was the request; if it turns out to be noise, that is a
capture of its own and it is a smaller change than guessing now.

## Acceptance

`sudo systemctl start fernscout-backup.service` on the VPS sends a mail whose
subject says it succeeded, and a run that fails still sends the failure mail
with the failure stamp written. `npm run alert -- --unit x --outcome success
--dry-run` prints the success wording without sending.
