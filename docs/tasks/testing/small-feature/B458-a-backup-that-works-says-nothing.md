---
id: B458
title: A backup that works says nothing, so the only evidence the alarm is alive is an alarm
type: FEATURE
priority: medium
complexity: low
area: backups
found: "2026-09-05T12:52:31Z"
started: "2026-09-05T12:52:53Z"
merged: "2026-09-05T13:02:13Z"
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

## What was built

One branch in `scripts/alert.sh`, one flag on `scripts/alert.mts`, one line in
the unit. No second script and no second template: systemd gives both handlers
the same instance name, so the script asks `systemctl show` which one ran it.

`OUTCOME=success` requires `Result=success` **and** `ExecMainStatus=0`. Every
other state — no `systemctl` on the box, an empty property, a Result nobody has
seen — is a failure, and `--outcome` on the mailer applies the same rule to its
own argument: anything that is not exactly `success` reads as a failure. A mail
that wrongly says the backup worked is the only outcome worse than no mail.

The success path writes no stamp and does not exit non-zero when it cannot
mail. `scripts/backup.sh` is the one author of "the backup worked", at the point
where it knows the snapshot is whole; a handler that knows only systemd's exit
code could otherwise stamp a success over a run that pushed a partial snapshot.
And a success that could not be sent is not news worth putting the alert unit
into `failed` for — which, with `OnFailure=` wired up, would ask for a second
mail about the first one not going out.

### One thing found on the way, and fixed here rather than captured

`readMail` in `test/alert-script.test.ts` decoded the `.eml` wrongly. It matched
runs of `^[A-Za-z0-9+/=]{60,}$`, and a base64 block's last line is shorter than
the rest — so each block was decoded in fragments, every fragment starting at
whatever offset the last one ended on. The output read almost right, with words
broken across invented newlines (`how th\ne last run ended`) and a tail left as
raw base64. Assertions in that file were passing or failing on message length.

It is fixed to decode by MIME part, honouring CRLF. Not a separate capture
because it is the instrument this task's acceptance is read with: the first
version of the success test failed against a correct mail, which is exactly the
error in the other direction.

## Evidence

- `npm run alert -- --unit fernscout-backup.service --outcome success --dry-run`
  prints *"finished cleanly"* and *"from the unit's OnSuccess=."*
- `test/alert-script.test.ts` — the success wording, and that `[]`,
  `--outcome ""`, `--outcome Success` and `--outcome ok` all read as failures.
- `test/backup-script.test.ts` — a stubbed `systemctl` reporting
  `Result=success`/`0` takes the success path, writes neither stamp and exits 0.
  The two tests beside it already cover the no-systemctl default.
- `test/systemd-units.test.ts` needed no change: its allow-list already places
  `OnSuccess=` in `[Unit]`, which is the trap B203 was.
