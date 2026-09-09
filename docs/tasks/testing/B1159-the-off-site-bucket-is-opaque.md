---
id: B1159
title: The off-site bucket is opaque blobs with no note in it, and keeps thirty nights
type: FEATURE
priority: medium
complexity: low
area: backup, DR, off-site
found: "2026-09-09T19:28:26Z"
started: "2026-09-09T19:28:59Z"
merged: "2026-09-09T19:29:55Z"
---

# B1159 — The off-site bucket is opaque blobs with no note in it, and keeps thirty nights

## Why

B1075 switched the off-site copy on and it works. What it produces is a
restic repository at the bucket root: `data/`, `index/`, `snapshots/`,
`keys/`. Opening the bucket tells the owner nothing — not which nights are
there, not how old the newest is, and nothing at all about how to get a
journal back out. The one moment that view matters is the moment the server is
gone, which is also the moment `restic snapshots` is not to hand.

Retention was inherited from `BACKUP_KEEP_DAILY`, which is 30 on this
instance. Seven nights off-site is what was actually wanted.

## Work

`RESTIC_REPOSITORY_SECONDARY` ending in the literal token `/<date>` switches
`scripts/backup.sh` step 8d to a **repository per night** at
`<base>/YYYY-MM-DD`, with `BACKUP_SECONDARY_KEEP_DAYS` (default 7) of them
kept and a `RESTORE.txt` at the base rewritten on every successful copy.
Absent the token, everything behaves exactly as B659 shipped it.

The trade is deliberate and is written into the script beside the code: a
standalone repository per night cannot deduplicate against the night before,
so each run uploads the whole set rather than the delta — ~600 MiB and about
two minutes here, and the wrong choice on a repository ten times larger.

Two consequences worth knowing:

- Tonight's repository is created when missing, which `BACKUP_INIT_IF_MISSING`
  refuses for the primary. That guard exists because a typo in the primary
  becomes a green backup protecting nothing; a dated secondary is *supposed*
  to be new nightly and never decides whether the run succeeded.
- Expiring a night deletes a whole prefix, which restic has no verb for. Local
  paths use `rm -rf`; S3 needs `rclone` on PATH, and without it the copy still
  lands while the expiry is a logged WARNING. The remote is built from the
  same `AWS_*` variables restic reads, through `RCLONE_CONFIG_SEC_*` in the
  environment, so no `rclone config` file exists and no key reaches a command
  line where `ps` would show it.

The success stamp moves earlier in this layout than in the single-repository
one: the copy landing is the success, so a machine with no rclone reports the
off-site copy as healthy — which it is — rather than permanently stale.

Not doing: anything to the primary, the backup set, or the single-repository
path.

## Acceptance

`test/backup-script.test.ts` drives the real script against a dated local base
seeded with eight nights: the token expands to today, tonight's repository is
created and `restic check`s clean, the two oldest of nine are deleted, a
non-date sibling is untouched, and `RESTORE.txt` names the nights that remain
and not the ones deleted — and does not contain the repository password.

Live: the bucket lists dates and a `RESTORE.txt`, seven of them after a week,
and a restore from one dated folder alone produces a readable day.

## Outcome (2026-09-09, live)

Merged, deployed, and driven on the VPS.

`rclone` installed (1.60.1, from apt). `/etc/fernscout/env` now carries
`RESTIC_REPOSITORY_SECONDARY='s3://…/fernscout/<date>'` and
`BACKUP_SECONDARY_KEEP_DAYS=7`. The bucket was emptied first, with the
operator's confirmation — all 11 nights were still in the local primary and
nothing was lost.

One run of `fernscout-backup` produced, in order: `creating tonight's off-site
repository`, the copy, the secondary stamp, `1 off-site night(s) held, keeping
7 — nothing to expire`, `refreshed …/RESTORE.txt`. The bucket root is now
exactly two entries — `2026-09-09/` and `RESTORE.txt`.

Restore proved from the dated folder alone: `restic check` on
`…/fernscout/2026-09-09` reports `no errors were found` across 11 snapshots,
`restic restore latest` produced 606 MiB and 2249 files, and
`content/example/trips/alps-2024/entries/2024-09-12-over-the-susten.md` reads
back with its frontmatter intact. `env/fernscout.env` inside it holds no
`RESTIC_PASSWORD` line, which is the claim RESTORE.txt makes about itself.
Scratch target removed. `/api/health` -> `.backup.secondary` reads `ok`.

### The quoting trap, found by hitting it

`<date>` unquoted in `/etc/fernscout/env` is fine for systemd, which does not
shell-parse that file — and fatal to `set -a; . /etc/fernscout/env`, which is
the first line of every restore procedure in `docs/runbook.md`. It dies with
`Syntax error: newline unexpected`, at the exact moment somebody is trying to
get the journals back. Single quotes satisfy both readers; systemd strips
them. Written into the runbook, `.env.example` and the script header in a
second commit.

### Still standing

B1158 is unchanged by this and is now slightly more pressing: the key in
`/etc/fernscout/env` can delete, and `rclone purge` is proof of that. It is
also the key that expires old nights, so an append-only key needs the expiry
moved or dropped — that trade is B1158's work.
