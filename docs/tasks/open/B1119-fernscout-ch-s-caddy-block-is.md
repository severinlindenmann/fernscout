---
id: B1119
title: fernscout.ch's Caddy block is hand-merged, so proxy directives drift until applied by hand
type: OPS
priority: low
complexity: low
area: ops, caddy, deploy
found: "2026-09-09T17:42:16Z"
---

# B1119 — fernscout.ch's Caddy block is hand-merged, so proxy directives drift until applied by hand

## Why

The live host's `/etc/caddy/Caddyfile` carries a **hand-merged** copy of the
Fernscout site block, not the `import /srv/fernscout/deploy/fernscout.caddy`
line B66 landed on. `severin.io` runs on the same Caddy, which is why the
machine has one hand-maintained file rather than the import.

The consequence, seen on 2026-09-09 with B1088: a proxy directive added to
`deploy/fernscout.caddy` reaches the host on `git pull` but **not** the running
config — `scripts/deploy.sh` only *reports* the drift (`report_caddy`, by
design: "nothing about the proxy is this script's to change"), never applies
it. B1088's TRACE→405 handler had to be merged into `/etc/caddy/Caddyfile` by
hand and `caddy reload`ed separately before it went live. Every future
`fernscout.caddy` change will drift the same way and need the same manual step.
This is the exact shape of B01, which was deployed, reported healthy, and had
no effect for a day — the thing B66 exists to prevent.

## Work

Switch the machine's `/etc/caddy/Caddyfile` `fernscout.ch { … }` block to the
one-line import, so `git pull` + `caddy reload` is the whole update and
`check:caddy` stops reporting drift:

    import /srv/fernscout/deploy/fernscout.caddy

- **First confirm the caddy service's environment has `CADDY_DOMAIN` and
  `PORT`.** `deploy/fernscout.caddy` uses `{$CADDY_DOMAIN}` and
  `{$PORT:3000}`; the hand-merged block used literal `fernscout.ch` and
  `127.0.0.1:3000`, so the import only validates if caddy resolves those. Check
  the systemd unit / `/etc/caddy` env before switching (`systemctl show caddy
  -p Environment`, or an `EnvironmentFile`). If they are not set, either set
  them for the caddy service or keep literals in a per-host include.
- Leave `severin.io` and `www.fernscout.ch` untouched — global options and the
  two neighbour blocks are the operator's.
- `sudo caddy validate --config /etc/caddy/Caddyfile` before `sudo systemctl
  reload caddy`. A timestamped backup of the pre-B1088 file is already on the
  host (`/etc/caddy/Caddyfile.bak-b1088-*`).
- Not the deploy script's job to do this (B66) — this is a one-time operator
  action on the host, recorded here so it is not rediscovered on the next
  proxy change.

## Acceptance

- On the host, `/etc/caddy/Caddyfile` contains the `import` line rather than a
  hand-copied Fernscout block.
- `npm run check:caddy` on the host exits 0 ("the running config carries what
  this release expects").
- A subsequent `deploy/fernscout.caddy` change reaches the live proxy with only
  `git pull` + `caddy reload`, no hand-editing.
