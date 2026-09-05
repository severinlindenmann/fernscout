---
id: B462
title: systemd logs 'multiple trigger source candidates' every backup run now that one handler serves both OnFailure and OnSuccess
type: CHORE
priority: low
complexity: low
area: backups
found: "2026-09-05T13:03:44Z"
---

# B462 — systemd logs 'multiple trigger source candidates' every backup run now that one handler serves both OnFailure and OnSuccess

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

B458 pointed `OnFailure=` and `OnSuccess=` at the same handler instance, and
systemd says so on every run:

```
fernscout-alert@fernscout-backup.service.service: multiple trigger source
candidates for exit status propagation (fernscout-backup.service,
fernscout-backup.service), skipping.
```

What it is declining to do is set `MONITOR_EXIT_STATUS` and its siblings in the
handler's environment: it cannot say which of the two triggers to attribute the
status to when both name the same unit. Harmless here — `scripts/alert.sh` never
reads those variables, it asks `systemctl show` for `Result` and
`ExecMainStatus`, which is why the classification works and the success mail
arrived. Verified on the VPS 2026-09-05.

It is still a warning nobody has explained, on the alarm path, appearing nightly
in the journal an operator reads *during an incident*. That is the wrong moment
to be wondering whether the alerting is misconfigured.

## Work

A comment in `deploy/fernscout-backup.service` next to the two directives,
saying what the line means and why the script does not care — the same shape as
the `[Unit]`-not-`[Service]` note already there from B203.

Not doing: splitting into two handler units to silence it. The duplicate
instance is what keeps this to one script and one template, and the price is a
log line rather than a behaviour.

## Acceptance

Somebody who greps the journal for that sentence lands on the explanation
without opening a task.
