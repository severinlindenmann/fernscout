---
id: B1119
title: fernscout.ch's Caddy block is hand-merged, so proxy directives drift until applied by hand
type: OPS
priority: low
complexity: low
area: ops, caddy, deploy
found: "2026-09-09T17:42:16Z"
merged: "2026-09-11T18:06:47Z"
completed: "2026-09-11T19:13:13Z"
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


## Done, 2026-09-11 — and the naive version would have taken the site down

`/etc/caddy/Caddyfile` now carries the one line B66 intended:

```
import /srv/fernscout/deploy/fernscout.caddy
```

`severin.io` and the `www.fernscout.ch` redirect are untouched — both are the
machine's, not the release's.

**The trap, which is the reason this was not a one-line change.**
`deploy/fernscout.caddy` addresses its site as `{$CADDY_DOMAIN}` and its port as
`{$PORT:3000}`, so one file can serve any instance. **`CADDY_DOMAIN` was set
nowhere Caddy could see it** — no `EnvironmentFile`, no `Environment=`, no
drop-in; the unit is a bare `caddy run --environ --config /etc/caddy/Caddyfile`.
Importing the file as it stood would have produced a site block addressed by an
empty string.

So the import needed a home for that variable first, and it is
`/etc/systemd/system/caddy.service.d/fernscout.conf` — operator-owned, outside
the checkout, surviving a package upgrade, and the natural counterpart to the
one line in `/etc/caddy`.

## How it was verified

- `/etc/caddy/Caddyfile` backed up to `Caddyfile.bak-b1119-20260911-200531`
  before anything was written.
- `caddy validate` against the new file, with the unit's own environment, before
  any reload: **Valid configuration**.
- After the restart, over TLS from outside: `fernscout.ch` 200,
  `fernscout.ch/api/health` 200, `www.fernscout.ch` 200, **`severin.io` 200** —
  the neighbour site was the thing most at risk and it is fine.
- `TRACE https://fernscout.ch/` → **405**, so the `handle @debugmethods` block
  from the imported file is live (B1088).
- `npm run check:caddy` → *"the running config carries what this release
  expects"*.

**One thing checked by the designed mechanism rather than behaviourally, and it
should be said plainly.** B01's `header_up X-Forwarded-For {remote_host}` is the
load-bearing line — without it every rate limit on this server can be reset by
forging a header. I could not observe it end to end, because the request log
records the user agent and not the client address. What does cover it is
`check-caddy.mts`, which this file's own header calls "the backstop: it compares
what Caddy is actually running against this file" — and it passes. That is the
check the project built for this question, not a substitute I chose.

Before this change that check compared the running config against a copy
somebody had merged by hand and could silently stop matching. Now the running
config *is* the file.
