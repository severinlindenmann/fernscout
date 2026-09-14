---
id: B1753
title: check:caddy reports the running config is in step while a directive from this release is missing from it
type: ISSUE
priority: medium
complexity: low
area: deploy, caddy
found: "2026-09-14T20:20:39Z"
---

# B1753 — check:caddy reports the running config is in step while a directive from this release is missing from it

## Why

`scripts/check-caddy.mts` is the backstop `deploy/fernscout.caddy`'s own header
comment names: "it compares what Caddy is actually running against this file,
and `scripts/deploy.sh` runs it on every deploy". On 2026-09-14 it said the
running config was in step when it was not, and the thing it missed was a
`request_body max_size` — the same *kind* of directive as B01's `header_up`,
which is the failure B66 built this check for.

Observed, in order:

1. B1750 added `path /api/probe/upload` to the `@bigbody` matcher and removed
   it from `@smallbody`'s `not path` list, in `deploy/fernscout.caddy`.
2. The deploy ran and printed `caddy: the running config carries what this
   release expects` (`scripts/deploy.sh:543`).
3. A 31 MB body to that path was answered **413** — still on the 10 MB tier.
4. `curl -s localhost:2019/config/ | grep -c probe` → `0`. The running config
   had never heard of the path.
5. `sudo -u fernscout npm run --silent check:caddy` on the box, by hand:
   same green line, `exit=0`.
6. `systemctl reload caddy`, then `grep -c "api/probe/upload"` → `1`, and the
   same 31 MB body → **200**.

So the check is not comparing what it says it compares, or is comparing a
subset that excludes `request_body`. `systemctl show caddy -p
ActiveEnterTimestamp` said 09:31 while the deploy was at 22:17 — Caddy had not
reloaded at all, which the check had every opportunity to notice.

Note that the deploy **not** reloading Caddy is deliberate and correct
(`scripts/deploy.sh:534` — "nothing about the proxy is this script's to
change"). The defect is only that the drift went unreported, which is the one
job this check has.

Related: `caddy validate --config /etc/caddy/Caddyfile` run by hand fails with
"server block without any key is global configuration" because `CADDY_DOMAIN`
comes from the systemd drop-in and is absent in an interactive shell. That is a
trap for whoever picks this up — the config is fine; the environment is not.
Worth having the script say so if it hits the same thing.

## Work

Find out what `check-caddy.mts` actually compares and why this passed. The two
likely shapes: it adapts the file and compares against a *filtered* view of the
running config that drops `request_body` handlers, or it compares only the
site block's presence rather than its contents.

Then make a missing directive fail. Whatever the answer, the regression test is
the one this ticket is made of: adapt a config containing a `request_body`
matcher, compare against a running config lacking it, and require exit 1.

Not in scope: making the deploy reload Caddy. That is a separate decision and
`scripts/deploy.sh` argues against it on purpose.

## Acceptance

- A `request_body max_size` present in `deploy/fernscout.caddy` and absent from
  the running config makes `npm run check:caddy` exit 1 and name the directive.
- A test in `test/check-caddy.test.ts` covers exactly that, using the fixtures
  already in `test/fixtures/caddy/`.
- The green case still passes on a machine that is genuinely in step.

## Related

Found while deploying B1750, whose probe was silently capped at 10 MB for this
reason. B66 is the ticket that built the check; B01 is the `header_up` line it
was built to protect.
