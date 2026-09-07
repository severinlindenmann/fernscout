---
id: B659
title: The only backup is on the machine it is backing up
type: CHORE
priority: medium
complexity: medium
area: backup, DR, off-site
found: "2026-09-07T06:19:24Z"
started: "2026-09-07T12:24:00Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T12:24:00Z"
---

# B659 — The only backup is on the machine it is backing up

## Why

`RESTIC_REPOSITORY=/var/backups/fernscout` — a directory on the same VPS as
`DATA_DIR` and `content/`. The nightly run is real, restic's encryption and
retention are real, and none of it survives the machine. Losing the VPS —
hardware, a compromise, a closed account, a mistaken `rm` at the wrong
path — takes the journals and every snapshot of them in one go.

What it *does* protect against is worth naming, because it is not nothing:
somebody deleting a trip, a bad ingest, a corrupt write. That is the failure
this has always covered and still covers.

Space is not the constraint: 671 GB free, and the repository is 966 MB.

W42 proposed Proton Drive as the second destination and the operator dropped
it on 2026-09-07 (B654, B655, both superseded) — the shape of the addition
was right and the destination was not. A cheap S3-compatible bucket is the
expected answer.

## Work

- Add a second destination, keeping W42's shape, which is the part worth
  reusing: `restic backup` to the local repository as now, then `restic copy
  --from-repo` into the remote. **The local repository alone decides whether
  the night succeeded**; the remote gets its own stamp and its own line in
  `/api/health`, and a stale remote says so without turning the backup red.
  B651 is why: an alert that fires every night is one nobody reads.
- Pick the bucket. Backblaze B2 and Hetzner object storage are both plausible
  at this size; the script's own header already carries a B2 example.
- The credential goes in `/etc/fernscout/env`, which since B653 travels in the
  backup — so an object-storage key that can *delete* is a key that can delete
  the copy an attacker just found. Use an append-only or write-only key where
  the provider offers one, and say in the task which you used.
- 30 dailies remotely, matching local.

## Acceptance

- A night lands in both, and `restic check` passes against the remote.
- With the remote credentials deliberately wrong, the unit exits zero,
  `/api/health` reports the backup ok with a stale secondary, and no alert
  fires.
- `docs/runbook.md` says which repository to restore from and that either
  answers.
