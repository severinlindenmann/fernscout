---
id: B444
title: The backup stages content/ twice because CONTENT_DIR lives inside DATA_DIR
type: ISSUE
priority: medium
complexity: low
area: backups
found: "2026-09-05T12:27:12Z"
started: "2026-09-05T12:33:20Z"
merged: "2026-09-05T12:40:47Z"
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

## What was built

`is_inside <child> <ancestor>` in `scripts/backup.sh`, resolving both with
`cd … && pwd -P` so a symlinked `CONTENT_DIR` is answered by where it points
rather than how it was spelled, and one branch on the content stage:

```
elif [[ -d "$DATA_DIR" ]] && is_inside "$CONTENT_DIR" "$DATA_DIR"; then
  log "content/ ($CONTENT_DIR) is inside DATA_DIR — already staged at data/, not copying it twice"
```

The log line is not decoration. Skipping a stage silently is how an operator
reads the journal after an incident and concludes the journals were left out of
the snapshot; it says where they are instead.

`docs/runbook.md` step 6 said `$STAGED/content/` "is a second copy of the same
bytes" — true when it was written, and now there is no such directory in a
snapshot from the nested layout. Corrected, along with the note below it, which
told an operator not to rsync a directory that no longer exists.

Not done: nothing about `stage_tree` or the refusal to stamp a success on an
incomplete snapshot. That is B114 and it is correct — the double-counting was
the caller, not the counter.
