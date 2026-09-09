---
id: B1088
title: TRACE returns HTTP 500 instead of 405 on pages and API
type: ISSUE
priority: low
complexity: low
area: http, proxy
found: "2026-09-09T15:49:15Z"
merged: "2026-09-09T16:11:26Z"
completed: "2026-09-09T16:46:27Z"
---

# B1088 — TRACE returns HTTP 500 instead of 405 on pages and API

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Deploy note (2026-09-09)

Code shipped to `main` and pulled to the host, but **not yet live**: the fix is
a directive in `deploy/fernscout.caddy`, and `scripts/deploy.sh` only *reports*
Caddy drift (B66), never reloads. The live host has a **hand-merged**
`/etc/caddy/Caddyfile`, so the pulled file is not what Caddy is running. Deploy
confirmed the drift:

```
WARNING: the proxy config is not what this release expects. Missing from /etc/caddy/Caddyfile:
  - static_response: {"handler":"static_response","status_code":405}
```

To make it live, on the host (operator action — shared proxy, root):
- replace the hand-merged Fernscout block with `import /srv/fernscout/deploy/fernscout.caddy` (so it never drifts again), **or** add the `@debugmethods method TRACE TRACK` / `handle { respond 405 }` block by hand;
- then `sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy`.

Verify: `curl -s -o /dev/null -w "%{http_code}" -X TRACE https://fernscout.ch/` → expect **405** (currently 500).
