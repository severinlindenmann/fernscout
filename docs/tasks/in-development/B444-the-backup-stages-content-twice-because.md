---
id: B444
title: The backup stages content/ twice because CONTENT_DIR lives inside DATA_DIR
type: ISSUE
priority: medium
complexity: low
area: backups
found: "2026-09-05T12:27:12Z"
started: "2026-09-05T12:33:20Z"
session: 7c3dd4ae-2d91-4172-8ea8-52deb35f9f42
claimed: "2026-09-05T12:33:20Z"
---

# B444 — The backup stages content/ twice because CONTENT_DIR lives inside DATA_DIR

## Why

On the VPS `/etc/fernscout/env` sets

```
DATA_DIR=/var/lib/fernscout
CONTENT_DIR=/var/lib/fernscout/content
```

so `CONTENT_DIR` is *inside* `DATA_DIR`. `scripts/backup.sh:212` stages
`DATA_DIR` — which already carries `content/` — and then `:224` stages
`content/` a second time into `$STAGING_DIR/content`.

Two costs, both real and both observed:

- **Every night copies ~320 MiB twice** into the staging directory before
  restic is called. restic dedupes the snapshot, so the repository is not
  doubled; the local disk, the CPU and the wall clock are.
- **Every unreadable path is counted twice.** B401's two stray `.bak` files
  were reported as *"4 path(s) missing"*, which is the number an operator has
  to reconcile against a WARNING list naming two files. The arithmetic is
  right and the message is confusing.

The double-staging is not wrong, only wasteful — it is why nobody noticed for
as long as the two paths have been nested.

## Work

Skip the `content/` stage when `$CONTENT_DIR` is already under `$DATA_DIR`, and
log that it was skipped and why (the operator reading the log must not conclude
content is missing from the snapshot). Keep the separate stage for the
un-nested layout, which is what a fresh clone and `.env.example` still give.

Not doing: any change to `stage_tree` or to the refusal-to-stamp-success
behaviour. That is B114 and it is correct.

## Acceptance

A run with `CONTENT_DIR` under `DATA_DIR` stages once, says so in the log, and
`restic snapshots` still shows the content tree in the snapshot. A run with the
two separate stages both, as now. `test/backup-script.test.ts` covers both.
