---
id: B520
title: a restart during an upload takes the site down for ninety seconds
type: ISSUE
priority: high
complexity: low
area: systemd, deploy, availability
found: "2026-09-05T21:10:00Z"
---

# B520 — a restart during an upload takes the site down for ninety seconds

## Why

Observed on fernscout.ch, 2026-09-05 23:05:01 → 23:06:31 CEST. A deploy
restarted the service while an agent was uploading photographs to
`severin/algarve-2026`. The journal:

```
23:05:01 systemd[1]: Stopping fernscout.service - Fernscout...
23:06:31 systemd[1]: fernscout.service: State 'final-sigterm' timed out. Killing.
23:06:31 systemd[1]: fernscout.service: Killing process 1291594 (next-server (v1) with signal SIGKILL
23:06:31 systemd[1]: fernscout.service: Failed with result 'timeout'
```

**Ninety seconds of 502.** `next start` did not exit on SIGTERM — it drains
in-flight requests, and there were thirty-three media uploads running from
23:01 to 23:04:55, each one a multi-megabyte body being decoded and resized.
systemd waited out the default `TimeoutStopSec` (90s), sent SIGKILL, and only
then started the new process, which was ready 1 second later.

`deploy/fernscout.service` sets `Restart=always` and `RestartSec=5` and says
nothing about stopping. So the ceiling on a restart is systemd's default, and
the only reason this has not been seen before is that every previous restart
happened on an idle instance.

Two things follow that are worse than the outage itself:

- **The deploy reported failure and was right to.** `scripts/deploy.sh` polls
  `/api/health` for 30 seconds, gave up at 23:05:31 while the old process was
  still refusing to die, and therefore did not advance `$APP_DIR/.deploy-state`
  — it still names `dd17a28` while `bc35fd7` is serving. That is the state
  machine working (it never records a commit it did not see healthy), but it
  means the next deploy re-plans from a commit two merges back and does more
  work than it needs to.
- **It is silent from outside.** By the time anybody looks, the site is up and
  healthy on the new commit. The only evidence is in `journalctl`.

## Work

`deploy/fernscout.service` needs a bounded stop. The shape:

```
TimeoutStopSec=20
KillMode=mixed
```

`mixed` sends SIGTERM to the main process only and SIGKILL to the rest of the
cgroup at the timeout, which is the right division for `npm → sh → next-server`:
Next gets its chance to drain, and the npm wrapper is not left holding the
group open.

Twenty seconds is a guess and should be argued in the ticket rather than
merged as an assumption — it is the trade between "an upload is killed
mid-flight" and "the site is 502 for a minute and a half". An upload that dies
is retried by the agent; a ninety-second outage is not retried by a reader.

**Also decide** whether `scripts/deploy.sh`'s 30-second health poll should
outlast the stop timeout. As it stands a stop that takes longer than the poll
guarantees a false failure, whatever the two numbers are; the poll must be the
larger of the two by construction, not by coincidence.

**Not doing:** draining connections at the proxy, or a two-instance rolling
restart. This is one VPS with one process; the fix is to bound the stop, not
to remove the gap.

## Acceptance

- `systemd-analyze verify deploy/fernscout.service` passes with the new
  directives.
- With an upload deliberately in flight, `sudo systemctl restart fernscout`
  completes in under the new timeout, and `journalctl` shows no
  `final-sigterm timed out`.
- A deploy run during that upload records its commit in `.deploy-state` — i.e.
  the health poll outlasts the stop.
- `test/deploy-plan.test.ts` still passes; `deploy/*.service` changes classify
  as `units, restart`.
