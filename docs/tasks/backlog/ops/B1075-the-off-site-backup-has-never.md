---
id: B1075
title: The off-site backup has never once succeeded, and the nightly run failed two days ago
type: OPS
priority: high
complexity: low
area: backup, DR, off-site
found: "2026-09-09T10:55:35Z"
---

# B1075 — The off-site backup has never once succeeded, and the nightly run failed two days ago

## Why

Read off `https://fernscout.ch/api/health` on 2026-09-09 at 10:55 UTC, not
assumed:

```json
"backup": {
  "lastSuccessAt": "2026-09-09T01:40:05.000Z",
  "ageHours": 9.3,
  "lastFailureAt": "2026-09-07T01:35:24.000Z",
  "lastFailure": "fernscout-backup.service failed (result=exit-code) (exit 1)",
  "secondary": {
    "state": "unknown",
    "lastSuccessAt": null,
    "reason": "no off-site copy has ever recorded a success in DATA_DIR …"
  },
  "state": "ok"
}
```

Two separate things, and the second is the one that matters.

**The nightly run failed on 2026-09-07** and nobody heard about it. It has
succeeded since, so `state` is `ok` and the failure is a field nothing reads.
One failure is noise; the value of recording it is that a *second* one has
somewhere to be noticed from, and today nothing does the noticing.

**No off-site copy has ever succeeded.** B659 was the ticket that named this
exact risk — *"the only backup is on the machine it is backing up"* — and it
shipped, and is `completed`. What it shipped was the capability. The health
route cannot tell whether `RESTIC_REPOSITORY_SECONDARY` is unset by choice or
set and silently failing, and says so honestly. Either way the property B659
was written to establish does not hold on the running instance: losing the
VPS still takes the journals and every snapshot of them together.

This is worth its own ticket rather than reopening B659 because the work is
different. B659 was "build the second destination". This is "find out which of
the two states we are in, and end up in neither".

**Not a duplicate of B1045**, which was captured the same morning from the
same `curl`. That ticket is about the *leak* — an unauthenticated route naming
the host's systemd unit and its failures to a stranger. This one is about the
*fact* the leak revealed: that the off-site copy does not exist. Fixing either
leaves the other standing.

## Work

An engagement against the live instance, not a diff.

- Establish which it is: `RESTIC_REPOSITORY_SECONDARY` unset, or set and
  failing. `/etc/fernscout/env` on the VPS and the unit's journal answer it.
- If unset: decide the destination and set it. A restic repository somewhere
  that is not this VPS and not the same provider account.
- If set and failing: read the error and fix it. A credential, a bucket
  policy, a clock.
- **Then prove a restore**, not a backup. `docs/disaster-recovery.md` is the
  procedure and running it is the only thing that turns "there is a copy" into
  "there is a copy that works". Do it from the off-site destination
  specifically.
- Decide whether a failed nightly run should reach a person, and how. The
  health route already carries `lastFailure`; nothing reads it on a schedule.
  Consider whether that is a second ticket.

Not doing: changing the backup script, or the retention policy. B659's work is
sound; this is about whether it is actually running.

## Acceptance

`/api/health` reports an off-site copy with a real `lastSuccessAt`, and
somebody has restored a journal from that copy and read a day out of it.
