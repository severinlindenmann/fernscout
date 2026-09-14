---
id: B1698
title: The deploy's own backup line is blank because it reads health unauthenticated
type: ISSUE
priority: medium
complexity: low
area: deploy, backup
found: "2026-09-14T08:40:00Z"
merged: "2026-09-14T06:34:53Z"
---

# B1698 — The deploy's own backup line is blank because it reads health unauthenticated

## Why

`scripts/deploy.sh` prints backup state on every run, and B64's whole argument
for that line is that the failure it reports is one nobody goes looking for.
The line it actually prints is:

```
==> backup: ok (last success )
```

`report_backup` reads `b.reason ?? b.lastSuccessAt`, and **both of those are
detail-gated**: `app/api/health/route.ts:445` serves
`publicBackupStatus(readBackupStatus())` to any caller without `HEALTH_TOKEN`,
which keeps `state` and `maxAgeHours` and drops `lastSuccessAt`, `ageHours`,
`lastFailureAt`, `lastFailure` and `reason`. The deploy fetches
`http://127.0.0.1:3000/api/health` with no `Authorization` header
(`scripts/deploy.sh:539`), so it is that anonymous caller.

The redaction is right and is not the bug — B1045 put it there deliberately, and
an unset `HEALTH_TOKEN` entitling nobody is the correct default. The bug is that
the deploy is entitled and does not ask: it is running **on the server**, it has
already sourced `/etc/fernscout/env` at line 149, and `HEALTH_TOKEN` is set
there on this instance.

**The failing case is the one that matters.** On success the operator loses a
date. On failure the line reads

```
WARNING: backup failing —
```

with the reason cut off, because `reason` is gated too. So the one moment this
line exists for is the moment it says least, and the operator is sent to
`journalctl` to find out what the deploy had already been told.

## Work

Send `Authorization: Bearer $HEALTH_TOKEN` on the deploy's own health fetch when
that variable is set, and carry on unauthenticated when it is not — a fresh
install with no token must keep working, with the same trimmed line it gets
today.

Keep the token out of `argv`: `curl -H "…$HEALTH_TOKEN"` puts it in
`/proc/<pid>/cmdline`, readable by the `fernscout` service user on this box.
`curl --config -` fed from a heredoc keeps it on stdin.

Not doing: changing what `/api/health` redacts, or who may read it.

## Acceptance

A deploy on an instance with `HEALTH_TOKEN` set prints a real timestamp:
`backup: ok (last success 2026-09-14T05:01:57Z)`. The token appears in no
process listing and in no deploy output. With `HEALTH_TOKEN` unset the deploy
still succeeds and still prints the state.
