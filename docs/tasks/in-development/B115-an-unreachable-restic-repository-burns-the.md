---
id: B115
title: An unreachable restic repository burns the unit's whole 30-minute timeout
type: ISSUE
priority: low
complexity: low
area: backup, ops
found: "2026-09-01"
started: "2026-09-03"
---

# B115 — An unreachable restic repository burns the unit's whole 30-minute timeout

> Renumbered from **B82** on 2026-09-03. That id was already carried by the
> expired-read-grant task; two sessions in parallel worktrees were handed it on
> the same afternoon. B99 is the fix.

## Why

Measured while building B63, on a laptop, against `rest:http://127.0.0.1:1/`
— a port with nothing listening, which is the fastest possible "unreachable":

```
restic cat config    still retrying after 3 minutes; killed, not finished
```

restic retries with exponential backoff and no overall deadline. `scripts/backup.sh`
now announces the probe before making it (B64), so the journal says what the
silence is — but it is still silence, and the only bound on it is
`TimeoutStartSec=30min` in `deploy/fernscout-backup.service`.

The cost is not the wasted half hour. It is that the alert somebody is waiting
for (`OnFailure=`, B64) does not fire until the timeout does, so a repository
that went unreachable at 03:20 tells nobody until 03:50 — and a `Persistent=`
timer that fires on a machine which was asleep can stack that up.

Nothing here is wrong, exactly. It is just far slower than the information
justifies: at the moment the probe is made, the answer "cannot reach it" is
already available within a couple of seconds of the first refusal.

## Work

- Bound the probe with `timeout(1)`: `timeout "${BACKUP_PROBE_TIMEOUT:-120}" restic cat config`.
  Exit 124 then classifies as `unreachable`, which the B63 case statement
  already handles correctly — it is one more branch, not a new concept.
- `timeout` is coreutils and present on the VPS; it is **not** on macOS without
  `brew install coreutils`, which is why this was left out of B63 rather than
  guessed at. Either fall back to running unwrapped when neither `timeout` nor
  `gtimeout` exists (and say so once in the journal), or decide the script is
  Linux-only and require it.
- Consider whether `restic`'s own `--retry-lock` / backend retry options give a
  cleaner bound than wrapping the process.
- Reducing `TimeoutStartSec=` is not the fix on its own: the run is then killed
  rather than told what happened, and `Result=timeout` reads the same whether
  the repository was unreachable or the backup was merely large.

## Acceptance

- A run against a repository that refuses connections gives up in a bounded,
  configurable time and exits non-zero with `cannot read the repository`.
- The bound is exercised in `test/backup-script.test.ts`, skipped cleanly where
  no `timeout` binary exists — the same shape as the existing `restic`
  and root-user guards.

## What was built

`restic cat config` is now run under `timeout "${BACKUP_PROBE_TIMEOUT:-120}"`,
and exit **124** is classified as `unreachable` with a message that says what
happened: `no answer within 120s (BACKUP_PROBE_TIMEOUT), so the probe was
stopped`.

### The portability call: fall back, do not require

`timeout` is coreutils — present on the VPS, absent on macOS without
`brew install coreutils`. Neither `timeout` nor `gtimeout` exists on the
machine this was built on. **The script falls back to running the probe
unwrapped and says so once in the journal**, rather than being declared
Linux-only.

The deciding argument is not portability for its own sake. `test/backup-script.test.ts`
runs on a maintainer's laptop, and a backup script that cannot be exercised on
the machine where it is edited is worse than an unbounded probe on a machine
that has no repository to reach. The bound protects an unattended nightly run
on the VPS; the fallback costs a developer nothing, because a developer
watching a terminal can press ^C — which is precisely what the unattended run
cannot do.

The warning is logged, not silent, so a machine that has quietly lost coreutils
says so rather than appearing bounded.

### restic's own options were not a cleaner bound

The task asked. They are not:

- **`--retry-lock`** bounds waiting for a repository *lock*, which is a wait
  that happens *after* the repository has been reached. It cannot bound the
  case where it never is.
- The backend retry settings bound individual requests, not the call, which is
  the whole shape of the problem: restic retries with exponential backoff and
  no overall deadline.

Wrapping the process is the smaller mechanism and it composes with the case
statement B63 already wrote.

### 124 must not read as absent

Worth stating because it is the failure this probe exists to prevent: a
timed-out probe classified as `absent` would let `BACKUP_INIT_IF_MISSING=1`
run `restic init` over a repository that was merely slow to answer. The new
branch sits with the other `unreachable` cases, and both tests assert the run
never says `creating a NEW, EMPTY repository`.

### What ran here, and what did not

Both branches have a test, each skipping where its branch cannot exist — the
same shape as the existing `RESTIC` and `IS_ROOT` guards.

- `an unreachable repository gives up within BACKUP_PROBE_TIMEOUT` —
  **skipped on this machine**, which has no `timeout`. The bounded path was
  therefore *not* exercised locally; it will run on the VPS and on any CI with
  coreutils.
- `with no timeout binary the probe still runs, and says it is unbounded` —
  **ran, and passes.** It is deliberately pointed at the reachable fixture
  repository rather than at `127.0.0.1:1`: driving the unbounded probe at an
  unreachable host would sit in restic's backoff for minutes, which is the
  defect itself, inside the suite meant to run quickly.

That asymmetry is the honest state of it. The fallback is proven here; the
bound is proven where the bound exists.

### Line numbers

The Why cited `scripts/backup.sh` positions that **B114** moved when it added
`stage_tree()` earlier the same day. Corrected. Nothing else in the Why was
wrong: the probe is still announced before it is made (B64), and B63's case
statement does still handle `unreachable` correctly — verified rather than
assumed, since B63 moved to `completed/` mid-run.
