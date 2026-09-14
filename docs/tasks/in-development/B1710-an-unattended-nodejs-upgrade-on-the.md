---
id: B1710
title: An unattended nodejs upgrade on the VPS moved past the repo's exact Node pin and every deploy fails at the build guard
type: OPS
priority: high
complexity: low
area: Deploy
found: "2026-09-14T08:41:13Z"
started: "2026-09-14T08:41:29Z"
session: cbe9e605-52aa-4a47-affd-e1ef326bdda5
claimed: "2026-09-14T08:41:29Z"
---

# B1710 — An unattended nodejs upgrade on the VPS moved past the repo's exact Node pin and every deploy fails at the build guard

## Why

`ship.sh` failed on 2026-09-14 with the site left serving the old build:

```
Node 24.21.0 is active, but Fernscout requires Node 24.20.0 from .nvmrc.
```

An unattended-upgrades run moved `nodejs` from `24.20.0-1nodesource1` to
`24.21.0-1nodesource1` (one of ~130 packages in the same batch, alongside
systemd, postgresql-17 and openssl). The repository pins an exact patch in
three places — `.nvmrc`, `package.json` `engines.node`, and `NODE_VERSION` in
`.github/workflows/ci.yml` — so the box and the pin disagreed and the build
guard refused, correctly.

Nothing was damaged. `.deploy-state` still named the commit that was actually
serving, so the old build stayed up and healthy and the deploy re-plans from
there. The pull had already landed, which is why `scripts/backup.sh` (B1706)
is live on the box even though the build never ran — it needs no build.

**The bump is safe on the grounds the pin exists for.** That comment in
`ci.yml` pins an exact patch because a floating major silently changes the
bundled npm, and 24.20.0's npm 11.19.0 rejected a lockfile older npm accepted.
24.21.0 ships **npm 11.19.0 as well** — verified on the box and locally — so
`package-lock.json` does not need regenerating and the hazard does not apply.

The owner chose to follow the platform rather than hold the box back: holding
`nodejs` would stop Node security patches reaching the VPS and would recur at
every future bump.

## Work

Move all three pins to 24.21.0 together. Keep the `ci.yml` comment's reasoning
and update the npm fact in it.

## Acceptance

- `npm run verify` passes and CI is green on 24.21.0.
- `ship.sh` completes and `/api/health` reports the new commit.
