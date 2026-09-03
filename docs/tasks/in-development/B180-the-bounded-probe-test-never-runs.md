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

## What was built

`scripts/backup.sh` is unchanged. The whole fix is in
`test/backup-script.test.ts`.

A `TIMEOUT_SHIM` constant holds a ~15-line `/bin/sh` stand-in for coreutils
`timeout(1)`. `beforeAll` writes it, executable, into its own directory in the
scratch tree (`shim-bin/timeout`, deliberately *not* the existing `bin/` that
carries the `pg_dump` and old-restic stubs, so a shimmed probe cannot arrive by
accident in a test about something else). `withTimeoutShim()` returns a `PATH`
override, and `runBackup` merges it like any other env var.

The shim backgrounds the command, arms a watcher that touches a marker file and
sends `TERM` (then `KILL`) after the requested seconds, and exits **124** if the
marker exists — otherwise it passes the command's own status through. The
marker, rather than the child's exit status, is what decides: a command killed
by a signal nobody sent is not an expiry. The watcher's own output is
redirected, because the probe captures this process's stderr and a shell job
notification landing in `probe_error` would read as restic's words.

`restic` is not stubbed. The shim wraps the real binary against the real
unreachable address, exactly as the script does on the VPS.

Three tests where there were two:

- **`an unreachable repository gives up within BACKUP_PROBE_TIMEOUT, not the
  unit timeout`** — no longer guarded, runs everywhere, uses the shim.
- **`…and the same holds with the real timeout(1), where coreutils is
  installed`** — the same assertions via a shared `expectGaveUpBounded()`,
  `skipIf(!HAS_TIMEOUT)`. The shim's keeper: where the real binary exists it
  must reach the same verdict, or the shim has drifted from what runs on the
  VPS. It skips here, and that is the point — it is about coreutils, not about
  the script.
- **`the shim exits 124 only on expiry, so the bounded case is not asserting a
  constant`** — the shim on `PATH`, pointed at a path with no repository.
  restic exits 10, the run must still read *absent*. A shim that returned 124
  for everything would pass the bounded test against a script that had stopped
  bounding anything at all.

### The assertion the task did not ask for, and needed

The original test asserted `cannot read the repository` and the absence of
`creating a NEW, EMPTY repository`. **Both hold with the 124 branch deleted.**
A timed-out probe falls through to the message-reading fallback, which finds
`connection refused` in restic's retry output and lands on `unreachable`
anyway — for a reason that has nothing to do with the bound, and that would not
hold for a backend whose stall says nothing at all.

So `expectGaveUpBounded` also asserts the 124 branch *by name*:

```
no answer within 2s (BACKUP_PROBE_TIMEOUT)
```

Verified by breaking `scripts/backup.sh` (`probe_status == 124` →
`== 9124`) and re-running: that one expectation fails, and only it. Restored
afterwards.

### What the shim does not prove

It is not coreutils and does not test coreutils. It takes no flags, knows
nothing of `-k` or `--signal`, and is only as faithful as the two things the
contract between the two files rests on: 124 on expiry, the command's own
status otherwise. Both are asserted. Everything past that is the keeper test's
job, on a machine that has the real binary.

### On the last acceptance line

`npx vitest run test/backup-script.test.ts` still reports two skips: the
real-Postgres test (pre-existing, `POSTGRES_TEST_URL`) and the new
real-`timeout(1)` keeper. **No skip remains for the case this task names** —
the bounded probe now runs here with a ✓. The keeper is a deliberate second
case, the one the Work section asked for; it cannot exist without skipping
where coreutils does not.

### Captured while here

**B195** — the mirror image. Now that the bounded branch runs everywhere, the
*fallback* branch is the one that skips wherever coreutils is installed, which
is every machine this ships to. Not absorbed into this task: it wants a pruned
`PATH` rather than a shim, and it is about a different branch.

The id is B195 and not B182, which this session was allocated: by the time the
work was committed, `main` already carried a different B182, B183 and B184,
written after this branch was cut. A gap in the numbering costs nothing; two
tasks answering to one id costs the only way tasks refer to each other.
