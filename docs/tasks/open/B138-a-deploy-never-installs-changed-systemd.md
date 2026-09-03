---
id: B138
title: A deploy never installs changed systemd units, so unit changes stay in git and nobody notices
type: ISSUE
priority: high
complexity: low
area: deploy, systemd, ops
found: "2026-09-03"
---

# B138 — A deploy never installs changed systemd units

## Why

Found while verifying B64, which **fails on the live server for this reason
alone**. The application half of B64 shipped and works; the systemd half never
arrived, and the systemd half is the entire notification mechanism.

```
$ ssh 95.216.112.173 'stat -c "%n %y" /etc/systemd/system/fernscout-backup.service'
… 2026-09-01 20:37:01 +0200
$ ssh 95.216.112.173 'systemctl show fernscout-backup.service -p OnFailure'
OnFailure=
$ ssh 95.216.112.173 'systemctl cat "fernscout-alert@fernscout-backup.service"'
No files found.
```

`deploy/fernscout-backup.service:21` carries `OnFailure=fernscout-alert@%n.service`
and `deploy/fernscout-alert@.service` exists in full. Both live only in git.
The units on the box are the 2026-09-01 copies.

`scripts/deploy.sh` pulls, installs, migrates, builds and restarts. Its only
write under `/etc/systemd/system/` is the `git-sha.conf` drop-in
(`scripts/deploy.sh:80-86`). Installing a unit is a manual `sudo cp`, documented
in a comment in each unit's own header — so **any unit change merged after the
last manual copy stays behind silently, and the deploy reports success.**

This is not specific to B64. It is a class:

- Nothing compares `deploy/*.{service,timer}` with what is installed.
- A deploy that changes a unit and a deploy that does not are indistinguishable
  from their output.
- The failure is invisible from the application side. `/api/health` reports on
  the app; it has no view of whether the units around it are current.
- It is silent by construction — the person who merged the unit change has no
  reason to suspect it did not land, because everything else in the same commit
  did.

The shape is worth naming, because it is the same one B64 was written about:
something that fails without telling anyone, discovered only when somebody goes
looking. Here it is one level up — the mechanism that was supposed to end
silent failures was itself silently not installed.

What it has already cost: B64 merged on 2026-09-01 and has been in `testing/`
since, appearing done. A failed nightly backup on fernscout.ch today still
notifies nobody, which is precisely the condition B64 was raised to remove.

## Work

Make the deploy responsible for the units it ships.

- Copy changed `deploy/*.service` and `deploy/*.timer` into
  `/etc/systemd/system/` during `scripts/deploy.sh`, then `systemctl
  daemon-reload`. Enable anything newly added; do not disable anything, since
  an operator may have units this repo does not know about.
- Or, if installing units automatically is judged too much authority for a
  deploy to hold: **diff them and fail loudly.** A deploy that says
  "fernscout-backup.service differs from deploy/ — run `sudo cp …` and
  `daemon-reload`" is worth most of the value and takes no privileges the
  script does not already have. Given the script already writes a drop-in under
  `/etc/systemd/system/`, the authority argument is thin.
- Restart or reload the affected units when their definitions change. A copied
  unit file that nothing reloads is the same bug with an extra step.
- Say in the runbook that units are deployed, and delete the "copy this by
  hand" comments from the unit headers once they are untrue.

Not doing: a general configuration-management tool. This is four files and a
`cp`; the point is that nobody is watching, not that the mechanism is hard.

## Acceptance

- Changing a unit in `deploy/` and running `scripts/deploy.sh` results in that
  change being live — or in the deploy failing with a message naming the file.
- `fernscout-backup.service` on the deployed server carries
  `OnFailure=fernscout-alert@%n.service`, and
  `fernscout-alert@fernscout-backup.service` resolves.
- With that in place, B64's first acceptance bullet can be re-tested: a failed
  backup run notifies a person without their asking.
- The runbook describes how units reach the server, and no unit header still
  claims it must be copied by hand if that is no longer true.
