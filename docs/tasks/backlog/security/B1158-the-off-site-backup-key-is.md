---
id: B1158
title: The off-site backup key is a full-access key that travels inside the snapshot it protects
type: SECURITY
priority: medium
complexity: low
area: backup, DR, credentials
found: "2026-09-09T19:08:22Z"
---

# B1158 — The off-site backup key is a full-access key that travels inside the snapshot it protects

## Why

B1075 switched the off-site copy on (Hetzner Object Storage, bucket
`fernscout` at `fsn1.your-objectstorage.com`). It works, and `restic check`
passes. Two things about *how* it is credentialed are worth closing.

**The key can delete.** `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in
`/etc/fernscout/env` are a full-access pair. Since B653 that env file is
staged into the snapshot as `env/fernscout.env`, so anybody who opens a
snapshot — from either repository — finds the key that empties the off-site
one. The runbook already advises an append-only or write-only key here and
says exactly this; the instance does not follow its own advice yet.
`restic forget --prune` against the secondary needs delete, so an append-only
key means moving the secondary's pruning somewhere else or accepting unbounded
growth. That trade is the actual work.

**Same provider as the VPS.** The server is Hetzner and so is the bucket, so
one account compromise reaches both. `docs/runbook.md` calls a second bucket
at the same provider "not an off-site copy". It is still a large improvement
over what was there on 2026-09-08, which was nothing off the machine at all —
but it is not the property B659 was written to establish.

## Work

- Decide whether Hetzner Object Storage offers a key scoped to one bucket
  without delete, and whether restic's `forget --prune` can live without it
  (a periodic prune from elsewhere, holding a separate key, is one shape).
- Or move the secondary to a different provider entirely — Backblaze B2 has
  application keys with exactly this shape. The repository is under 1 GB.
- Either way, rotate the pair currently in `/etc/fernscout/env`: it has been
  inside every snapshot taken since 2026-09-09.

Not doing: changing what the backup set contains. Staging the env file is
deliberate (B653) and a restore needs it.

## Acceptance

The credential the nightly run holds for the secondary cannot delete a
snapshot from it, or the secondary is at a provider whose account compromise
does not also reach the VPS. `restic check` against the secondary still
passes afterwards, and `/api/health` -> `.backup.secondary` still reads `ok`
the morning after.
