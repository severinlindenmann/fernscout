---
id: B654
title: Whether restic can drive rclone's Proton Drive backend well enough to trust it
type: OPS
priority: medium
complexity: medium
area: backup, Proton Drive, rclone
found: "2026-09-07T05:44:26Z"
---

# B654 — Whether restic can drive rclone's Proton Drive backend well enough to trust it

## Why

**Design: `docs/plans/W42-what-a-backup-owes.md`.** Step 2 of its Order, and
it is a spike with permission to conclude no.

The instance has one backup destination. W42 adds a second on Proton Drive,
reached by `restic copy` into an `rclone:protondrive:` repository — which
keeps restic's deduplication, encryption, retention and integrity checking and
changes only where the bytes land.

What is not known is whether that works. rclone's `protondrive` backend is
**Beta, and reverse-engineered from an API Proton does not publish**. Its own
documentation warns that its cache does not notice external changes and that
modification times cannot be set. Neither is obviously fatal for a
write-mostly restic repository, and neither is obviously safe.

This is deliberately an `OPS` engagement rather than a feature: the
deliverable is an answer and the findings, not a diff.

## Work

- Create a **dedicated Proton account** for this. Not the operator's own:
  where the account has 2FA, rclone needs `RCLONE_PROTONDRIVE_OTP_SECRET_KEY`,
  which is the TOTP *seed* and not a code, and it would live in
  `/etc/fernscout/env` on a public web server. W42 has the reasoning.
- Establish whether restic's built-in `rclone:` backend drives it at all —
  `restic init`, a backup of a few hundred megabytes, `restic check`, and a
  restore of one file out of it.
- Measure: how long does ~555 MiB take, and what does a second night cost once
  deduplication applies.
- Try the failure modes that matter to a nightly unit: a run interrupted
  part-way, two runs overlapping, and what a stale rclone cache does to
  `restic check` the next day.
- Write what you find into this task. **"No" is a complete answer** — B653 has
  already banked the DR gap and the size, and B655 is written to depend on
  this one.

## Acceptance

- A written answer: does this work, how fast, and what breaks it.
- If yes: the exact env vars and rclone version that worked, ready for B655.
- If no: what failed, and whether another destination is worth capturing
  instead.
