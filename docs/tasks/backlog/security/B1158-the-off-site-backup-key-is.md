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

## Half of this is fixed (2026-09-09)

**The key no longer travels inside the snapshot.** `scripts/backup.sh` step 6
stripped `RESTIC_PASSWORD` from the staged env file; it now strips
`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` beside it. The escalation this
ticket named — decrypt a snapshot, find inside it the credential that empties
the off-site copy of it — is closed.

Proved live rather than argued: tonight's env file restored out of
`s3:…/fernscout/2026-09-09` holds 36 variables, `DATABASE_URL` and both
`RESTIC_REPOSITORY*` URLs among them, and zero lines matching
`^RESTIC_PASSWORD=`, `^AWS_ACCESS_KEY_ID=` or `^AWS_SECRET_ACCESS_KEY=`.

The cost is named in `docs/disaster-recovery.md`: a restored server takes no
backup until those three are put back by hand. That is loud — restic fails and
`/api/health` reports it — and it costs a restorer nothing they did not
already have, since reaching the bucket to fetch the snapshot needed the keys
first.

## What the provider actually supports, measured

Probed against the live bucket with a signed request, not read off a
documentation page. Hetzner Object Storage is Ceph RGW (`fsn1-prod1-ceph5`):

| | |
| --- | --- |
| Bucket lifecycle rules | **supported** — `PUT` accepted, `GET` read it back |
| Bucket policy | **supported** — answers `NoSuchBucketPolicy`, not `NotImplemented` |
| Versioning | supported, not enabled |
| Object lock | API understood (`ObjectLockConfigurationNotFoundError`); needs versioning and a bucket created for it |

The probe rule was removed again; the bucket carries no lifecycle
configuration.

**A lifecycle rule is deliberately not being used for retention.** It would
let the nightly key drop `DeleteObject`, which is the shape this ticket wants
— but an age-based rule keeps deleting while the backup is *not* running, so
nine quiet days would leave an empty bucket rather than a stale one. Stale and
honest beats empty. If retention moves to the bucket, it needs a floor that
never deletes the last N nights, and RGW lifecycle cannot express one.

## What is left, and it needs a person

- **Rotate the pair.** They sat inside every snapshot taken between the
  off-site copy going live and this fix. Retention ages those out of the
  off-site copy in seven days and out of the primary in thirty; rotating does
  not wait for either. It is a Hetzner console action — an agent has no
  credential that can mint one. Paste the new pair in and the wiring is two
  `sed` lines.
- **A narrower key, or a second provider**, for the case this ticket opened
  with: root on the VPS still reaches a key that can delete the off-site copy.
  That is inherent to any push-based backup and is what append-only keys and
  object lock exist for. Object lock is available here and would need a new
  versioned bucket and a decision about what locked storage costs.

## Acceptance, narrowed

The credential the nightly run holds for the secondary is not one that has
ever been inside a snapshot, and either cannot delete from the bucket or the
bucket enforces immutability the VPS cannot revoke.
