---
id: B1312
title: A restart with no rebuild strands the service, and a corrupted Turbopack cache fails the build until cleared
type: OPS
priority: medium
complexity: low
area: deploy, vps, turbopack
found: "2026-09-10T15:19:26Z"
---

# B1312 — A restart with no rebuild strands the service, and a corrupted Turbopack cache fails the build until cleared

## Why

Going live with B1234 meant one edit to `/var/lib/fernscout/config.json`
(`features.signup.phoneBackend: "whatsapp-inbound"`) and a restart. Two
things went wrong on the VPS, both worth writing down.

1. **`systemctl restart fernscout` with no fresh build strands the service.**
   The unit runs `next start`, which needs a matching `.next`. On this box
   `.next` was not in a state `next start` accepted, so the service went into
   a restart loop (`Could not find a production build in the '.next'
   directory`) and the site 502'd. A config-only change still needs a build
   step, or at least a `.next` known to match — a bare restart is not safe.

2. **The build then failed on a corrupted Turbopack persistent cache.**
   `npm run build` panicked in `turbo-persistence`:
   `range start index N out of range for slice of length M`, surfacing on
   whichever page collected first (`/opengraph-image`, then
   `lib/photobook/worldland.ts`) — which reads like a code fault and is not.
   `rm -rf .next node_modules/.cache .turbo` and a clean rebuild fixed it.
   A concurrent sibling-session deploy racing the same checkout also produced
   a transient `ENOENT ... _buildManifest.js.tmp`, i.e. two builds clobbering
   one `.next`.

Recovery took the site down for several minutes. Both are operational, not
code — hence OPS.

## Work

- Consider whether `scripts/deploy.sh` should clear the Turbopack cache when a
  build fails and retry once, rather than leaving a corrupt cache to fail
  every subsequent build identically.
- Consider a lock in `deploy.sh` so two sessions cannot build the same
  checkout at once (the `ENOENT` tmp race).
- Document in the vps skill / runbook: a config-only change on the VPS still
  needs `deploy.sh` (or a rebuild), never a bare `systemctl restart`; and a
  `turbo-persistence` panic means clear the caches, not debug the named page.

## Acceptance

The runbook names both traps; ideally `deploy.sh` self-heals a corrupt
Turbopack cache. Verified by a deploy that survives a deliberately corrupted
`.turbo`.


## Related

Partly covered by B1313, which is the higher-priority write-up of the same
deploy surface and whose Work already carries the lock and the self-healing
Turbopack retry this file asks for. **Not superseded** — the third bullet here
has no counterpart there: writing both traps into the vps skill and the
runbook, so that a config-only change is known to need a build and a
`turbo-persistence` panic is known to mean clear the caches rather than debug
the page it names. Build B1313 and fold this file's documentation bullet into
the same pass.
