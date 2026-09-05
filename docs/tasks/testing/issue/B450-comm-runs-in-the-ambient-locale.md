---
id: B450
title: comm runs in the ambient locale against LC_ALL=C-sorted input, so the backup names readable files as missing
type: ISSUE
priority: high
complexity: low
area: backups
found: "2026-09-05T12:42:21Z"
started: "2026-09-05T12:45:37Z"
merged: "2026-09-05T12:50:27Z"
---

# B450 — comm runs in the ambient locale against LC_ALL=C-sorted input, so the backup names readable files as missing

## Why

`scripts/backup.sh` builds the list of paths that failed to stage from two
sources, and one of them is a `comm` against two `LC_ALL=C sort`ed lists:

```sh
candidates="$( { unreadable_paths "$src"; comm -23 <(printf '%s\n' "$before") <(list_tree "$dest"); } | LC_ALL=C sort -u )"
```

`list_tree` and `unreadable_paths` both sort under `LC_ALL=C`. **`comm` does
not** — the prefix on `sort` inside the pipeline does not reach it, so it
collates in whatever locale the process has. systemd gives the unit
`LANG=en_US.UTF-8`, and the run says so out loud:

```
comm: file 1 is not in sorted order
comm: file 2 is not in sorted order
comm: input is not in sorted order
WARNING: 3 path(s) under DATA_DIR could not be staged
WARNING:   /var/lib/fernscout/content/config.json.bak-20260905102530   <-- readable
```

That file is `fernscout:fernscout 0600` and the unit runs as `fernscout`;
`find . ! -exec test -r {} \; -print` does not name it. It is in the list
purely because `comm` mis-ordered its inputs.

Reproduced on the VPS, deterministic, and the locale is the whole difference —
the same script, same tree, same user:

| Run | Result |
| --- | --- |
| `sudo -u fernscout bash backup.sh` | 2 paths, no warning — correct |
| `... LC_ALL=en_US.UTF-8 bash backup.sh` | 3 paths, `not in sorted order` |
| `systemctl start fernscout-backup` | 3 paths, `not in sorted order` |

**It is worse than noise.** The whole point of B114 is that this list is
trusted: it decides whether the snapshot is tagged `partial`, whether the run
records a success, and whether `OnFailure=` fires. A `comm` given input it
considers unsorted produces a wrong difference in *both* directions — it can
name a file that was staged fine, and it can miss one that was not. A genuinely
unreadable file slipping out of that list is a snapshot reported as complete
when it is not, which is the one outcome B114 exists to prevent.

## Work

`LC_ALL=C comm`. The two producers already sort that way; the consumer has to
read that way.

Not doing: anything about the locale of the unit, or exporting `LC_ALL` for the
whole script. A script that only works under one `LANG` is the same bug waiting
for the next command, and pinning the one comparison that needs it is smaller
than pinning the environment.

## Acceptance

A test that sorts the two lists `LC_ALL=C`, runs the comparison under a UTF-8
locale, and fails on the current code. On the VPS,
`sudo systemctl start fernscout-backup.service` names two paths, not three, and
prints no `not in sorted order`.

## What was built

`LC_ALL=C comm`, and a comment saying why the prefix on the sorts was not
enough. The diff is one word plus the reasoning.

**The test is honest about where it bites.** macOS `comm` does not check its
input's order, so the case cannot be constructed on the machine this suite is
usually run on. The test therefore asserts the correct outcome under
`LC_ALL=en_US.UTF-8` and passes trivially on darwin, failing on Linux — CI is
`ubuntu-latest` and so is the VPS, which are the two places it matters.

Verified on the VPS itself, same tree, same user, same UTF-8 locale, script
by hand with the staging trap off:

| | Paths named | `not in sorted order` |
| --- | --- | --- |
| before | 3, one of them readable | yes |
| after | 2, both genuinely unreadable | no |
