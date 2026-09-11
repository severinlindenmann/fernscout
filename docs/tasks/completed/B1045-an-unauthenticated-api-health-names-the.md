---
id: B1045
title: An unauthenticated /api/health names the host's systemd unit and its backup failures
type: SECURITY
priority: low
complexity: low
area: ops,health,privacy
found: "2026-09-09T06:15:56Z"
started: "2026-09-11T15:47:55Z"
merged: "2026-09-11T16:00:28Z"
completed: "2026-09-11T19:13:06Z"
---

# B1045 — An unauthenticated /api/health names the host's systemd unit and its backup failures

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

Split `backup` by audience rather than removing it. `publicBackupStatus()` in
`app/api/health/route.ts` is what an unentitled caller now gets in its place:
`state`, `maxAgeHours`, and the same two fields on `secondary`. Those three are
the ones a monitor actually asserts on (the module comment on
`readBackupStatus` already said so) and `maxAgeHours` is a policy number, not a
fact about the machine. Everything else — `lastSuccessAt`, `ageHours`,
`lastFailureAt`, the verbatim `lastFailure` text a systemd unit wrote,
`reason`, and `secondary`'s own timestamps and `reason` (which names
`RESTIC_REPOSITORY_SECONDARY`) — is now behind `HEALTH_TOKEN`.

**Not the admin identity cookie.** The ticket's own draft suggested gating
`backup` behind the identity cookie `/admin` uses; built it behind
`HEALTH_TOKEN` instead, the bearer token this same route already uses to gate
`config.error`, `content.error`, `basemap.error` and the whole `journals`
block (B473). Two reasons: an uptime monitor is not a browser and cannot hold
a cookie, so a cookie-gated `backup` would be unreachable from the tool that
actually reads it; and a second auth mechanism on one route is a second thing
to keep in sync with the first. Reusing the existing gate keeps the "public
state, detail behind one shared secret" shape consistent across every
redacted field on this page.

Audited the rest of the payload for the same class of leak (host paths, unit
names, env var names, provider accounts): `capabilities` reasons already name
only env vars and config keys, never a value (AGENTS.md's own promise);
`commit` is a git SHA, already listed as deliberately public; `media` and
`photobook` are limits, not host facts. Nothing else needed narrowing.

## Acceptance

- `curl -s https://fernscout.ch/api/health` as a stranger contains no systemd
  unit name, no `RESTIC_*` variable name, and no verbatim failure text — met:
  `backup` is `{ state, maxAgeHours, secondary: { state, maxAgeHours } }` only.
- The same request with `Authorization: Bearer <HEALTH_TOKEN>` still shows the
  full backup block, including `lastFailure` and `secondary.reason` — met.
- A test asserts the unauthenticated shape, so the detail cannot creep back
  in — `test/health-disclosure.test.ts` ("backup is trimmed to state and
  maxAgeHours — B1045", "HEALTH_TOKEN brings back the full backup block —
  B1045") and the updated assertion in `test/backup-status.test.ts`.
