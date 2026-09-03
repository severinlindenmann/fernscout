---
id: B138
title: A deploy never installs changed systemd units, so unit changes stay in git and nobody notices
type: ISSUE
priority: high
complexity: low
area: deploy, systemd, ops
found: "2026-09-03"
started: "2026-09-03"
merged: "2026-09-03T19:13:35Z"
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
  daemon-reload`. ~~Enable anything newly added;~~ do not disable anything,
  since an operator may have units this repo does not know about.

  **Corrected while building: enabling newly added units is wrong, and the
  repository already contains the counterexample.**
  `deploy/fernscout-worker.service:3-7` ships with an `[Install]` section and a
  header saying to enable it "when there is something for it to do" — nothing
  enqueues work until W10–W14. A deploy that enabled what it added would start
  a worker against an empty queue on the next deploy of any machine. So the
  line drawn is **the release owns the unit definitions, the operator owns what
  runs**: install and reload, never enable, disable or start. A unit that is
  installed and not enabled is *named* at the end of the run instead, which is
  a note a person can act on. The one-time `systemctl enable --now` stays in
  the runbook where it already was.
- Or, if installing units automatically is judged too much authority for a
  deploy to hold: **diff them and fail loudly.** A deploy that says
  "fernscout-backup.service differs from deploy/ — run `sudo cp …` and
  `daemon-reload`" is worth most of the value and takes no privileges the
  script does not already have. Given the script already writes a drop-in under
  `/etc/systemd/system/`, the authority argument is thin.
- Restart or reload the affected units when their definitions change. A copied
  unit file that nothing reloads is the same bug with an extra step.

  Built as: `daemon-reload` whenever anything changed, and additionally
  `restart` for a **changed timer that is already active** — a reload re-reads
  a timer's definition but leaves an armed timer on its old schedule, so a
  changed `OnCalendar=` would otherwise not take effect until the next boot.
  Services are not restarted here: `fernscout.service` and
  `fernscout-worker.service` are restarted by `deploy.sh` a few lines later,
  and `fernscout-backup.service` and `fernscout-alert@.service` are a oneshot
  and a template that nothing is holding open, so for those the reload is the
  whole of what "take effect" means.
- Say in the runbook that units are deployed, and delete the "copy this by
  hand" comments from the unit headers once they are untrue.

Not doing: a general configuration-management tool. This is four files and a
`cp`; the point is that nobody is watching, not that the mechanism is hard.

Not doing either: `deploy/Caddyfile`, which sits in the same folder and is not
a systemd unit. Caddy has exactly one config file per host, shared with every
other site on it, so copying that one over is a materially more dangerous act
than installing a unit — the runbook already warns about it. Its drift is
**B66**, and this task leaves it there.

## Built

`scripts/install-units.sh`, called from `scripts/deploy.sh` after the build and
before the restart — the units describe how to run what was just built, and the
restart below them is what adopts them. A failure there aborts the deploy with
the old site still serving, which is the same property the build-before-restart
order exists for.

It is a separate script rather than ten lines inside `deploy.sh` for one
reason: `deploy.sh` cannot be run in a test, because it pulls, runs `npm ci`
and builds. `install-units.sh` takes `SYSTEMD_DIR`, `UNIT_SRC` and `SYSTEMCTL`
from the environment, so `test/install-units.test.ts` drives the real script
against a temporary directory with a stub `systemctl` — without root, without
systemd, and without the VPS. `sync-shipped-content.sh` is the same shape for
the same reason.

The non-root path exits 1 and names each stale file with the `sudo cp` to fix
it, rather than warning and carrying on. A warning was considered and rejected:
the deploy still reporting success is the bug.

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
