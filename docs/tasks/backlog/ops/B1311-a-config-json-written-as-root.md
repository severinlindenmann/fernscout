---
id: B1311
title: A config.json written as root takes the whole site down at the next build
type: OPS
priority: high
complexity: low
area: ops, deploy
found: "2026-09-10T06:40:00Z"
---

# B1311 — A config.json written as root takes the whole site down at the next build

## What happened

fernscout.ch served **502 for about twenty minutes** on 2026-09-10.

`/var/lib/fernscout/config.json` was `-rw------- root root`. The service runs
as `fernscout`, which could not read it. Nothing noticed while the old build
kept serving, because `loadServerConfig` was already memoised in the running
process.

The next deploy is what turned that into an outage:

1. `next build` evaluates `app/opengraph-image.tsx`, whose `alt` calls
   `serverSite()` **at module scope**, which reads the config.
2. `ConfigError: /var/lib/fernscout/config.json is not usable — could not be
   read` → *"Failed to collect page data for /opengraph-image"*.
3. The build had already cleared `.next`, so `next start` had no production
   build and the service crash-looped.

Recovery took longer than the fault deserved because two things compounded it:
killing a half-finished `next build` left `.next` in a state where later
builds failed on a missing `pages-manifest.json`, and one interrupted run left
`node_modules` missing `next/dist/build/lib/verify-typescript-setup`. `rm -rf
.next` plus `npm ci` fixed both.

The file was last written at 17:09 beside a `config.json.bak-b1234`, so a
session working on B1234 edited it as root. Writing it with `sudo` and a
redirect or a fresh `open(…, "w")` creates a new root-owned file; editing the
existing inode in place would have kept the ownership.

## Work

Three independent guards, cheapest first:

- **`scripts/deploy.sh` checks the config is readable by the service user
  before it touches `.next`.** One `sudo -u fernscout head -c1` — a build that
  cannot succeed should never be allowed to delete the build that is serving.
- **Fix the ownership where it is written.** Anything that edits
  `/var/lib/fernscout/config.json` restores `fernscout:fernscout` afterwards.
  Worth a line in the `vps` skill, which is where these edits get made.
- **`/api/health` reports whether the config file is readable**, so this is
  visible before a deploy rather than during one.

Worth considering separately: `app/opengraph-image.tsx` calls `serverSite()` at
module scope purely for its `alt` text, which is what drags a config read into
build-time page collection. A lazy `alt` would make the build survive a
config it cannot read — which is not a reason to leave the config unreadable,
but is one less way for it to be fatal.

## Acceptance

- A deploy with an unreadable config fails **before** `.next` is cleared, and
  says which file and which user.
- `/api/health` names the problem.
- The live site is untouched by such a deploy, which is what the deploy skill
  already promises.
