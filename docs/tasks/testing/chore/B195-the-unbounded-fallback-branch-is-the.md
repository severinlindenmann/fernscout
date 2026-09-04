---
id: B195
title: The unbounded-fallback branch is now the one that never runs where coreutils is installed
type: CHORE
priority: low
complexity: low
area: tests, backup, ci
found: "2026-09-03"
started: "2026-09-04T07:17:29Z"
merged: "2026-09-04T07:49:24Z"
---

# B195 — The unbounded-fallback branch never runs where coreutils is installed

## Why

B180 made the *bounded* probe branch run everywhere, by putting a `timeout`
shim on `PATH` for that one case. Its mirror image is still guarded:

```
test.skipIf(HAS_TIMEOUT)("with no timeout binary the probe still runs, and says it is unbounded")
```

`test/backup-script.test.ts`. On a machine that has coreutils — the VPS, and
any CI runner built on Debian — that test skips, so nothing checks that
`scripts/backup.sh` still falls back cleanly and still logs
`neither timeout nor gtimeout is installed`. It runs today only because the
maintainer's laptop happens to lack the binary, which is the same accident
B180 was filed about, pointing the other way.

The cost is small — the fallback is four lines of shell — but it is the branch
that decides whether the script is usable on a machine without coreutils at
all, which is the reason the fallback exists.

## Work

The mirror of B180's fix, and cheaper: no shim is needed, only a `PATH` with
neither `timeout` nor `gtimeout` on it. `runBackup` already merges a `PATH`
override.

- Give the fallback case a `PATH` built from the directories that do *not*
  contain a `timeout` or `gtimeout` — or, simpler and more honest, a `PATH`
  containing only a scratch directory plus whatever the script genuinely needs
  (`restic`, `tar`, `date`), resolved by absolute path first.
- Keep it against the reachable fixture repository, for the reason the existing
  comment gives: pointing an unbounded probe at an unreachable address is the
  defect itself, inside the suite.
- If a pruned `PATH` turns out to make the script fail for unrelated reasons,
  say so in the test rather than working around it — that would itself be worth
  knowing.

**Not doing:** uninstalling anything, and not `HAS_TIMEOUT`-conditional
assertions that quietly test nothing.

## Acceptance

- `with no timeout binary the probe still runs, and says it is unbounded`
  passes on a machine that *does* have coreutils.
- The suite reports no skip for it on either kind of machine.

## What was built

`test/backup-script.test.ts`:

- `withoutTimeout()` — a scratch directory of symlinks to exactly the binaries
  `scripts/backup.sh` shells out to (`BACKUP_NEEDS`: restic, cp, find, test,
  sort, mkdir, rm, chmod, dirname, date, du, cut, wc, tr, grep, bash, sh, env),
  and `PATH` set to that directory alone. No `timeout`, no `gtimeout`, and
  nothing simulated: the script takes the fallback for the real reason,
  `command -v timeout` finding nothing.
- `with no timeout binary the probe still runs, and says it is unbounded` is no
  longer `test.skipIf(HAS_TIMEOUT)`. It runs everywhere, still against the
  reachable fixture repository, for the reason the existing comment gives.

`test` is in the binary list because `unreadable_paths()` runs
`find … ! -exec test -r {} \;` and find execs the binary, not a shell builtin.
A wrong list fails the run loudly on the missing command, which is the outcome
the task asked for.

## Evidence

A machine with coreutils was simulated by putting a `timeout` on PATH (the
laptop this was built on has none), and the same single test was run against
the file as it was before the change and after it:

```
# before — git show HEAD:test/backup-script.test.ts
PATH=/tmp/faketimeout:$PATH npx vitest run … -t "unbounded"
  Test Files  1 skipped (1)
  Tests  24 skipped (24)

# after
PATH=/tmp/faketimeout:$PATH npx vitest run test/backup-script.test.ts -t "unbounded"
  Test Files  1 passed (1)
  Tests  1 passed | 23 skipped (24)
```

And the whole file, unfiltered, on this machine: 23 passed, 1 skipped — the one
skip being `…and the same holds with the real timeout(1)`, which is correct
here and runs on the VPS and in CI.

Nothing about this needs the server.
