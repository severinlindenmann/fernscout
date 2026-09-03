---
id: B180
title: The bounded-probe test never runs, because it needs a coreutils binary macOS does not have
type: CHORE
priority: medium
complexity: low
area: tests, backup, ci
found: "2026-09-03"
started: "2026-09-03T19:43:08Z"
session: 0c03d994-da58-4a02-ab85-107825393b1a
claimed: "2026-09-03T19:43:08Z"
---

# B180 — The bounded-probe test never runs

## Why

**B115** bounded the restic probe with `timeout(1)` and shipped two tests, one
per branch, each skipping where its branch cannot exist. On the machine the
work was done on, the branch that skipped was the one that matters:

```
↓ an unreachable repository gives up within BACKUP_PROBE_TIMEOUT, not the unit timeout
```

`timeout` is coreutils. It is on the VPS and is **not** on macOS without
`brew install coreutils`, and neither `timeout` nor `gtimeout` is installed
here. So the *fallback* path — "no bound available, warn and carry on" — is
the only one ever exercised, and the actual fix B115 was written for has never
been run by anything.

B115 said so plainly rather than hiding it, which is why this is a follow-up
and not a correction. But "it will run on the VPS" is a promise, not evidence,
and nothing in this repository runs the suite on the VPS.

What is actually under test is **`scripts/backup.sh`'s handling** of a bounded
probe — that a `timeout` exit of 124 classifies as `unreachable` and never as
`absent`, because `restic init` over a repository that is merely slow is the
disaster the whole probe exists to prevent. That behaviour is the script's,
not coreutils'. It does not need real coreutils to be exercised; it needs
*something on PATH called `timeout` that exits 124*.

## Work

Make the bounded branch run everywhere, without requiring an install.

- Have the test put a small `timeout` shim on `PATH` for the duration of the
  bounded case — `runBackup` already builds the child's environment, so `PATH`
  is one more override. The shim must exit **124** on expiry, because that
  exit code is the whole contract between the two files.
- Keep a case that runs against the real binary where one exists, so the shim
  cannot drift from coreutils' behaviour unnoticed. `HAS_TIMEOUT` already
  distinguishes them.
- Be honest in the test's own comment about what the shim proves and what it
  does not: it exercises `backup.sh`'s classification, not coreutils.

**Not doing:** installing coreutils, in the suite or in a setup script. A test
suite that installs software on the machine running it is a worse problem than
the one being fixed.

## Acceptance

- `an unreachable repository gives up within BACKUP_PROBE_TIMEOUT` runs and
  passes on a machine with no `timeout` and no `gtimeout`.
- The bounded path is shown to classify as `unreachable`, and the run never
  says `creating a NEW, EMPTY repository`.
- The suite still passes where real coreutils *is* installed.
- `npx vitest run test/backup-script.test.ts` reports no skip for this case.
