---
id: B377
title: The deploy reported a healthy backup this afternoon and none at all this evening
type: OPS
priority: high
complexity: low
area: ops, backups
found: "2026-09-04T22:20:00Z"
---

# B377 — The deploy reported a healthy backup this afternoon and none at all this evening

## Why

Four deploys to fernscout.ch on 2026-09-04. The first three printed:

```
==> backup: ok (last success 2026-09-04T09:16:30.000Z)
```

The fourth, at about 22:15 UTC, printed:

```
WARNING: backup unknown — no backup has ever recorded a success in DATA_DIR —
either none is installed (see docs/runbook.md §Backups) or this DATA_DIR is not
the one it writes to
```

Same host, same day, same `ship.sh`. Not "the backup is stale" — *no backup has
ever succeeded*, which is a different and worse claim, and it contradicts the
timestamp the same check printed a few hours earlier. One of the two readings
is wrong, and either is worth knowing:

- the backup unit stopped or was removed between the two deploys, and the
  check is now correct; or
- `DATA_DIR` moved, or is being resolved differently, so the check is looking
  in the wrong place and the backup is fine but unverifiable.

The deploys in between were code changes to maps and colours (B361, B364,
B370, B375) — nothing that touches backups, `DATA_DIR` or systemd. So this is
more likely to be something on the host than something that shipped, but that
is a guess and the point of this task is not to guess.

Nothing was investigated on the host: this was found at the end of a deploy the
owner asked for, and prodding backup configuration on a live server is not
something to do unasked.

## Work

- Read the two readings against each other first: `journalctl` for the backup
  unit and timer around 2026-09-04, and what `DATA_DIR` resolves to now versus
  what the backup writes to. Which of the two stories above is true decides
  everything after it.
- If the unit is dead or was never installed: `docs/runbook.md` §Backups is the
  procedure, and the earlier `last success 09:16:30` timestamp needs
  explaining — a check that reported a success for a backup that does not
  exist is its own bug.
- If `DATA_DIR` moved: find what moved it, and whether the restore drill would
  have found the data where it now looks.
- **Run the restore drill either way.** A backup nobody has restored from is a
  belief, not a backup, and this is the moment the belief was questioned.
- Consider whether `ship.sh` should refuse, rather than warn, when the backup
  state goes from known-good to never-succeeded. A warning at the end of a
  successful deploy is easy to scroll past, which is how this nearly went
  unnoticed.

## Acceptance

- The two readings are reconciled: either the backup is running and the check
  is fixed, or the backup is not running and has been restored to working.
- A deploy prints a real `last success` timestamp again.
- The restore drill has been run once, end to end, and what it produced was
  checked rather than assumed.
