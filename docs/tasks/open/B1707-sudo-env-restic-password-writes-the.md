---
id: B1707
title: sudo ENV=RESTIC_PASSWORD writes the repository password into the journal
type: ISSUE
priority: medium
complexity: low
area: Backups
found: "2026-09-14T08:28:34Z"
---

# B1707 — sudo ENV=RESTIC_PASSWORD writes the repository password into the journal

## Why

Reaching the restic repository by hand as

```
sudo RESTIC_PASSWORD=… -u fernscout restic -r /var/backups/fernscout snapshots
```

puts the password on `sudo`'s command line, and `sudo` logs its `ENV=` argument
verbatim. The journal on the VPS currently holds, in plaintext:

```
Sep 14 06:57:47 sudo[3100022]: root : PWD=/root ; USER=fernscout ;
  ENV=RESTIC_PASSWORD=<the real value> ; COMMAND=/usr/bin/restic …
```

AGENTS.md: secrets are environment-only and never enter logs. This one is in a
journal that is retained, rotated and swept up by any log collection.

Split out of B1706, which was only about the backup failing.

## Decision already taken

**The owner declined rotation on 2026-09-14** — the exposure was judged
acceptable for who can read that journal. This ticket is therefore about not
writing it again, not about the value already there. Do not rotate
`RESTIC_PASSWORD` as part of this ticket.

## Work

Give the operator one documented way to run restic by hand that reads
`RESTIC_PASSWORD` from `/etc/fernscout/env` rather than taking it through argv,
and drops to the service user. Point the `vps` skill's wording at it, and fix
`scripts/backup.sh`'s own hint (around line 183), which currently suggests a
bare `sudo -u fernscout restic unlock`.

A wrapper that sources the env file and `exec`s restic is the whole job; the
password never becomes an argument to anything.

## Acceptance

- The documented path puts no secret on a command line.
- `journalctl | grep RESTIC_PASSWORD` gains no new entries after using it.
