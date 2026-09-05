---
id: B450
title: comm runs in the ambient locale against LC_ALL=C-sorted input, so the backup names readable files as missing
type: ISSUE
priority: high
complexity: low
area: backups
found: "2026-09-05T12:42:21Z"
started: "2026-09-05T12:45:37Z"
session: 7c3dd4ae-2d91-4172-8ea8-52deb35f9f42
claimed: "2026-09-05T12:45:37Z"
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
