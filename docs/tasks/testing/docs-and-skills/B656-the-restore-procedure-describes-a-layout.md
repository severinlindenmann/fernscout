---
id: B656
title: The restore procedure describes a layout the backup will no longer have
type: DOCS
priority: medium
complexity: low
area: runbook, DR, restore drill
found: "2026-09-07T05:44:27Z"
started: "2026-09-07T06:45:39Z"
merged: "2026-09-07T06:47:46Z"
---

# B656 — The restore procedure describes a layout the backup will no longer have

## Why

**Design: `docs/plans/W42-what-a-backup-owes.md`.** Step 4 of its Order.
Depends on B653, and on B655 where that lands.

`docs/runbook.md` describes restoring from a snapshot laid out as `data/` and
`content/`. B653 changes that layout to `db/`, `content/`, `config/` and
`env/`, so the procedure will describe something that no longer exists — and a
restore procedure that is wrong is worse than none, because it is followed
under pressure by somebody who has already lost the machine.

It also has a new step that has never been in it: **`RESTIC_PASSWORD` is
deliberately not in the backup** (B653), so the person restoring must have it
from somewhere else. If the runbook does not say where, the decision to strip
it turns a wide blast radius into an unrecoverable one.

## Work

- Rewrite the restore procedure for the new layout, including recreating
  `/etc/fernscout/env` from `env/fernscout.env` and adding `RESTIC_PASSWORD`
  by hand.
- State plainly, at the top, that `RESTIC_PASSWORD` lives outside the backup
  and where this operator keeps it.
- Where B655 landed, say which repository to restore from and that either
  answers.
- Update the timed restore drill to the new layout, and **run it once** — the
  drill is the only thing in W42 that proves any of it. A procedure nobody has
  followed since the layout changed is a draft.

## Acceptance

- The drill is run end to end against a clean target, from the new layout, and
  the resulting service starts.
- The runbook names where `RESTIC_PASSWORD` is kept.
- The time it actually took is recorded, as the drill asks.

## Done, 2026-09-07

Written as `docs/disaster-recovery.md` rather than as a rewrite in place, and
`docs/runbook.md`'s "Restore procedure" is now four lines pointing at it. Two
copies of a restore procedure is the failure this task exists to prevent, and
keeping the old section as prose beside a new file would have recreated it
within a month.

The drill was run, and it is recorded in the new document rather than here:
1487 files / 556 MiB restored in a second, the dump into a scratch Postgres 17
with real row counts, `env/fernscout.env` back with 22 variables and no
`RESTIC_PASSWORD`, and the service booted from the restored tree serving
journals, days and original photographs.

**The first boot failed**, on `features.contacts is enabled but
CONTACTS_ENCRYPTION_KEY is not set`. That is the argument for B653 stated by
the software itself, and it is now a section of the document rather than a
thing somebody rediscovers at the worst moment.

Two findings that were not in the ticket and are captured rather than absorbed:

- A restored copy runs with the **live SMTP credentials and WhatsApp token**
  that now travel in the snapshot, so an unmodified rehearsal mails the
  journal's real contacts. The document makes neutralising the outbound
  channels a required step of the drill.
- Restoring the dump needs a **Postgres 17** client. A v16 `pg_restore` refuses
  it with `unsupported version (1.16) in file header`, which reads like
  corruption and is not — written into the document so nobody concludes the
  backup is broken.

Not done: `RESTIC_PASSWORD`'s location is described as "wherever this
instance's operator keeps secrets" rather than named. Naming a password
manager in a public repository is not something this file should do.
