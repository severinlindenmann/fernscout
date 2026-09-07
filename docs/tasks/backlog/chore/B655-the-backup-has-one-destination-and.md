---
id: B655
title: The backup has one destination, and no second copy off Backblaze
type: CHORE
priority: medium
complexity: medium
area: backup, Proton Drive, health
found: "2026-09-07T05:44:26Z"
---

# B655 — The backup has one destination, and no second copy off Backblaze

## Why

**Design: `docs/plans/W42-what-a-backup-owes.md`.** Step 3 of its Order.
**Depends on B654** and must not start before it answers yes.

One destination is one failure away from none. W42 adds a Proton Drive copy,
and the shape of the addition matters more than the destination: **the primary
alone decides whether the night succeeded.**

That is not caution about Proton. It is what B651 cost — an alert that fires
every night is an alert nobody reads, and the next real failure arrives into a
channel that has been crying wolf. A second destination that can take the
backup down is a second destination nobody can afford to add until it is
already trusted.

## Work

- `restic backup` to the primary unchanged, then `restic copy --from-repo
  <primary>` into the Proton repository. Copy rather than a second backup run:
  it preserves deduplication, reads the snapshot just verified, and cannot
  corrupt the primary.
- A **second stamp** beside `.backup-last-success`, and a second line in
  `/api/health` via `lib/backupStatus.ts`. Primary decides `state`; a stale
  secondary says so and leaves `status: ok`.
- A Proton failure must exit zero and must not write a failure stamp for the
  primary. Prove it with a test that makes the copy fail.
- `--keep-daily 30` on both, up from 14. `restic forget` runs against each.
- Same repository password for both, so there is one secret to keep; say so in
  the runbook rather than only in the env file.

Not doing: an alert channel for Proton. Health reports it; nothing pages until
Proton has earned the critical path.

## Acceptance

- A night pushes to both, and `restic check` passes against the Proton
  repository.
- With the Proton account credentials deliberately wrong, the unit exits zero,
  `/api/health` reports the backup `ok` with a stale secondary, and the alert
  does not fire.
- Thirty dailies are retained in both.
