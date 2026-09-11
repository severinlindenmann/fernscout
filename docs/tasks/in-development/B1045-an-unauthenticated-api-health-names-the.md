---
id: B1045
title: An unauthenticated /api/health names the host's systemd unit and its backup failures
type: SECURITY
priority: low
complexity: low
area: ops,health,privacy
found: "2026-09-09T06:15:56Z"
started: "2026-09-11T15:47:55Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T15:47:55Z"
---

# B1045 — An unauthenticated /api/health names the host's systemd unit and its backup failures

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Found by driving the live site from outside with no credentials, as a stranger
would. `curl -s https://fernscout.ch/api/health` answers 200 to anybody and its
`backup` block reads:

```
"lastFailureAt": "2026-09-07T01:35:24.000Z",
"lastFailure": "fernscout-backup.service failed (result=exit-code) (exit 1)",
"secondary": {
  "state": "unknown",
  "reason": "no off-site copy has ever recorded a success in DATA_DIR — either
             RESTIC_REPOSITORY_SECONDARY is not set (this instance has one
             destination) or it has never copied successfully yet"
}
```

Three things reach a stranger there that they have no use for. The **systemd
unit name** (`fernscout-backup.service`) and the **restic environment variable**
(`RESTIC_REPOSITORY_SECONDARY`) name the host's own tooling, which is
reconnaissance rather than health. The **off-site posture** — that no second
copy has ever succeeded — tells an attacker how much of this instance is
recoverable, which is exactly the thing worth knowing before destroying it. And
the **failure text is passed through verbatim** from the unit, so whatever
systemd says next is published too; today it is an exit code, but nothing
constrains it to stay that harmless.

Note what is *not* wrong here: the primary backup is healthy
(`lastSuccessAt` 4.6h at the time of writing, against `maxAgeHours: 36`), and
`/api/health` being public is deliberate — AGENTS.md says a limit belongs where
a caller can read it before they hit it, which is why the upload formats and
sizes are there. This ticket is not an argument for closing the endpoint. It is
that the *backup* block answers an operator's question, not a caller's, and is
the one block on the page with no audience among strangers.

## Work

Split the health payload by audience rather than removing the block. The
capability list, the media limits and a plain overall state are what a caller
needs and should stay public. The `backup` block — or at least
`lastFailure`, the unit name, and `secondary.reason` — should answer only to
the operator, which on this instance means the admin identity cookie and
`FERNSCOUT_ADMIN_EMAIL`, the same gate `/admin` already uses.

Decide what an unauthenticated caller still sees for backup: probably a bare
`ok`/`stale` with no timestamps, no unit name and no reason string, so a
monitoring check keeps working without the detail. Do not simply truncate the
strings — a reworded leak is still a leak.

Check the same question for the rest of the payload while you are there: grep
the health route for anything else naming a host path, a unit, an environment
variable or a provider account.

## Acceptance

- `curl -s https://fernscout.ch/api/health` as a stranger contains no systemd
  unit name, no `RESTIC_*` variable name, and no verbatim failure text.
- The same request with the operator's identity cookie still shows the full
  backup block.
- A test asserts the unauthenticated shape, so the detail cannot creep back in.
