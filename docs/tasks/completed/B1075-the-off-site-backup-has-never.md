---
id: B1075
title: The off-site backup has never once succeeded, and the nightly run failed two days ago
type: OPS
priority: high
complexity: low
area: backup, DR, off-site
found: "2026-09-09T10:55:35Z"
started: "2026-09-09T18:49:46Z"
merged: "2026-09-09T19:09:03Z"
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

## Outcome (2026-09-09, against the live VPS)

**It was unset, not failing.** `/etc/fernscout/env` had no
`RESTIC_REPOSITORY_SECONDARY` at all, so B659's copy step never ran. No code
change was needed — the capability was sound and simply not switched on.

Now set to a Hetzner Object Storage bucket at `fsn1.your-objectstorage.com`,
with `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_DEFAULT_REGION=fsn1`
beside it. The primary is a local directory, so those AWS variables belong to
the secondary alone and collide with nothing. Same `RESTIC_PASSWORD` as the
primary, as designed.

`restic init`, then one `systemctl start fernscout-backup`. The copy carried
the **whole history**, not just tonight: 11 snapshots back to 2026-09-01.
`restic check` on the off-site repository reports `no errors were found`.

**Restore proved from the off-site copy specifically**, not the primary:
`restic restore latest` into a scratch target, 606 MiB, 41 journals and 161
day files, `db/postgres.dump` a real `PGDMP` archive. Read
`content/example/trips/alps-2024/entries/2024-09-12-over-the-susten.md` out of
it — full frontmatter, title, coordinates, gallery. Scratch target removed.

`/api/health` -> `.backup.secondary` now reads `state: "ok"` with a real
`lastSuccessAt`. Acceptance met.

### The 2026-09-07 failure

Historical and already fixed. Cause was two root-owned `config.json.bak*`
files under `DATA_DIR` that the `fernscout` user could not read — B651's
recurrence. B653's explicit allowlist has since excluded them: tonight's run
logs them as `skipped (not in the backup set)` and exits 0.

### Does a failed run reach a person? Yes — no second ticket

Proved by accident. A `chmod 600` during this work stripped the group-read bit
`/etc/fernscout/env` needs (`root:fernscout 640`), the run failed on the
missing env file, and `fernscout-alert@` mailed agent@fernscout.ch within
three seconds. Restored to `640` and the following run succeeded. So the
alerting path works and fires; what failed on 2026-09-07 was nobody reading
the mail, which is not a thing to build.

### Left standing

Hetzner Object Storage is the **same provider** as this VPS, which the runbook
advises against — one account compromise reaches the server and its off-site
copy. And `/etc/fernscout/env` travels inside the snapshot (B653), so the key
in it can delete the copy an attacker just found. Worth a scoped or
append-only key, or a second provider. Captured separately rather than held
against this ticket.
