---
id: B401
title: Nightly backups have been failing since two unreadable config.json.bak files appeared in the content root
type: OPS
priority: high
complexity: low
area: backups
found: "2026-09-05T07:28:44Z"
---

# B401 — Nightly backups have been failing since two unreadable config.json.bak files appeared in the content root

## Why

`/api/health` on fernscout.ch reports:

```
"backup": {"state": "failing", "lastSuccessAt": null,
           "lastFailureAt": "2026-09-05T01:32:13.000Z",
           "lastFailure": "fernscout-backup.service failed (result=exit-code) (exit 1)"}
```

`journalctl -u fernscout-backup.service` names the cause exactly:

```
WARNING: cp: cannot open '/var/lib/fernscout/content/./config.json.bak-b365' for reading: Permission denied
WARNING: cp: cannot open '/var/lib/fernscout/content/./config.json.bak-before-credits' for reading: Permission denied
WARNING: this snapshot is incomplete (4 path(s) missing) and will be tagged 'partial'
ERROR: the snapshot was pushed, but 4 path(s) are missing from it
ERROR: everything under DATA_DIR and content/ must be readable by the user this unit runs as (usually 'fernscout')
```

Two stray backup copies of `content/config.json` -- left by hand during other
work, named after B365 and the credits change -- are owned by somebody the
backup unit cannot read. The unit does the right thing with that: it stages
what it can, tags the snapshot `partial`, refuses to stamp the run a success,
exits non-zero and fires `OnFailure=`. **The backup machinery is behaving
correctly; the content root is what is wrong.**

Snapshots do exist (2026-09-01 through 09-05, ~300-490 MiB each), so this is
not "no backups". It is that every run since these files appeared is marked
incomplete and no run is recorded as a success -- which is also why
`lastSuccessAt` is null, and is worth reading together with **B373** (the
vanished backup marker).

## Work

Operator work on the host, not a code change:

1. Decide whether either `.bak` file is still wanted. They are hand-made copies
   of `content/config.json`; the live file is what serves.
2. Remove them, or `chown` them to the user the unit runs as, so everything
   under the content root is readable by it.
3. Re-run the unit and confirm `/api/health` reports `backup.state: ok` with a
   fresh `lastSuccessAt`.

Then consider the follow-up: a hand-edited stray file in the content root
should probably not be able to fail the backup silently for days. Either the
staging step ignores files matching an obvious backup-copy pattern, or the
deploy refuses to leave them there. Capture that separately once the immediate
fix is in.

## Acceptance

`curl -s https://fernscout.ch/api/health | jq .backup` reports `state: "ok"`
with a `lastSuccessAt` from the most recent nightly run.
