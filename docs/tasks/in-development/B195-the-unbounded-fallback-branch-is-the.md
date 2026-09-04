---
id: B195
title: The unbounded-fallback branch is now the one that never runs where coreutils is installed
type: CHORE
priority: low
complexity: low
area: tests, backup, ci
found: "2026-09-03"
started: "2026-09-04T07:17:29Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T07:17:29Z"
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
