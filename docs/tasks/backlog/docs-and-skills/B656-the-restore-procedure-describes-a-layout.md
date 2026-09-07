---
id: B656
title: The restore procedure describes a layout the backup will no longer have
type: DOCS
priority: medium
complexity: low
area: runbook, DR, restore drill
found: "2026-09-07T05:44:27Z"
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
