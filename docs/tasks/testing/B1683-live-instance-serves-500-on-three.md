---
id: B1683
title: Live instance serves 500 on three document routes: the build and node_modules disagree about sharp
type: OPS
priority: high
complexity: low
area: ops
found: "2026-09-13T14:38:16Z"
merged: "2026-09-13T19:50:33Z"
---

# B1683 — Live instance serves 500 on three document routes: the build and node_modules disagree about sharp

## Why

Three document routes answer 500 on the deployed instance:

```
/openapi.json              500
/api/v2/openapi.json       500
/content-model.json        500
/docs/api                  200
/documentation.txt         200
```

The server log names the cause, and it is not any of those routes:

```
⨯ Error: Failed to load external module sharp-20c6a5da84e2135f:
  Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'sharp-20c6a5da84e2135f'
  imported from /srv/fernscout/.next/server/chunks/[turbopack]_runtime.js
```

`sharp` is installed — `ls -d /srv/fernscout/node_modules/sharp` succeeds — so
the package is present under its own name and the build is asking for a
content-hashed alias that no longer exists. The `.next` build and
`node_modules` were produced at different times: a deploy that rebuilt without
re-running `npm ci`, or the reverse.

Alongside it, and probably the same staleness:

```
⨯ Error [InvariantError]: Invariant: The client reference manifest for route
  "/_not-found" does not exist. This is a bug in Next.js.
```

`/api/health` reports `status: ok` throughout, because it checks config,
content and the basemap and never asks whether the bundle can load its own
externals. A machine-readable contract that 500s is exactly the failure the
health check exists to catch, and it did not.

## Work

Run a full deploy — `.claude/skills/vps/ship.sh --full` — which re-runs
`npm ci` and rebuilds from the same tree, and judge the second run rather than
the first (`scripts/deploy.sh` pulls its own replacement partway through).

Then decide whether `/api/health` should load one bundled route before
answering `ok`. It would have caught this, and it is the only check here that
runs unattended.

Not doing: pinning or vendoring `sharp`. The package is fine; the two halves
of the deploy were out of step.

## Acceptance

- `/openapi.json`, `/api/v2/openapi.json` and `/content-model.json` all
  answer 200 and parse as JSON.
- `journalctl -u fernscout` shows no `ERR_MODULE_NOT_FOUND` after a restart.
