---
id: B63
title: A wrong RESTIC_REPOSITORY makes a new empty repo instead of failing
type: ISSUE
priority: medium
complexity: low
area: backup, ops
found: "2026-09-01"
---

# B63 — A wrong RESTIC_REPOSITORY makes a new empty repo instead of failing

## Why

`scripts/backup.sh:94–97` is a convenience that removes a failure mode from the
first run and adds a worse one to every run after it:

```bash
if ! restic snapshots >/dev/null 2>&1; then
  log "repository not initialised yet — running 'restic init'"
  restic init
fi
```

"Not initialised yet" and "not the repository you meant" are indistinguishable
from inside that `if`. Verified locally while writing `test/backup-script.test.ts`
for B21: with `RESTIC_REPOSITORY` pointing at a path that does not exist,
`restic init` **creates it**, `restic backup` pushes into it, `restic forget`
prunes it, and the script exits `0`. The journal says "repository not
initialised yet" — one line, at 03:20, in a run that otherwise looks like every
other successful night.

Every earlier snapshot is still in the old repository and still safe. What is
gone is anyone *knowing* that, and the retention policy now applies to a
fresh repository with one snapshot in it. A typo in `/etc/fernscout/env`, or an
`EnvironmentFile` that failed to load a variable, is enough.

On S3 the same shape holds for a wrong prefix in a bucket the credentials can
write to, which is the likely typo. A wrong *bucket* would probably fail on
permissions, which is luck rather than design.

Related: B64 (nobody is told when a backup fails). This is the inverse — the
backup does not fail, and that is the problem.

## Work

Decide whether auto-init is worth keeping at all; a `restic init` run by hand
once, at deploy time, is a small price. If it stays, distinguish the two cases:

- `restic cat config` (or `restic snapshots` with the error text kept) tells
  "repository absent" apart from "cannot reach it" / "wrong password". Only
  absent may auto-init.
- Gate auto-init behind an explicit `BACKUP_INIT_IF_MISSING=1`, off by default,
  so the nightly timer never creates a repository.
- Either way, log loudly and distinctly when a repository is created, and count
  the snapshots afterwards: a "successful" backup that leaves exactly one
  snapshot in a repository the operator believes has fourteen deserves a
  `WARNING` in the journal.

## Acceptance

- A run against a `RESTIC_REPOSITORY` that does not exist does not silently
  become a successful backup into a new repository.
- The existing first-run path is still documented and still works, by whatever
  route is chosen.
- Covered in `test/backup-script.test.ts`, which already has a local filesystem
  repository to point at a wrong path.
