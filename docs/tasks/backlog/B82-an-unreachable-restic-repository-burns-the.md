---
id: B82
title: An unreachable restic repository burns the unit's whole 30-minute timeout
type: ISSUE
priority: low
complexity: low
area: backup, ops
found: "2026-09-01"
---

# B82 — An unreachable restic repository burns the unit's whole 30-minute timeout

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
