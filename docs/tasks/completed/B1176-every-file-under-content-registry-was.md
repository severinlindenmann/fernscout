---
id: B1176
title: every file under content/.registry was root-owned, so the service account could not release a lock
type: OPS
priority: medium
complexity: low
area: ops, registry
found: "2026-09-09T20:20:00Z"
completed: "2026-09-11T16:20:57Z"
---

# B1176 — every file under content/.registry was root-owned, so the service account could not release a lock

## Why

On fernscout.ch, `content/.registry/`, `content/.registry/email/`,
`content/.registry/tel/` and all 43 lock files inside them were `root:root`,
timestamped within the same minute. The app runs as `fernscout`. So every
`release()` — the unlink that frees an address and a username when a journal is
deleted — failed with `EACCES`, and took the rest of the deletion down with it
(B1175).

`reserve()` would have failed the same way, which means **signup was broken
too**: `createJournal` reserves the address before it writes anything, so any
new journal on this instance would have died at that step. Nobody had tried
between the files being created and B1136 finding it.

The cause is a `scripts/` invocation run as root rather than
`sudo -u fernscout`. `npm run registry -- reconcile` is the obvious candidate —
it rewrites every lock file from disk, which matches all 43 files carrying one
timestamp. `scripts/deploy.sh` runs under `sudo` by design, so anything it
calls that touches `CONTENT_DIR` inherits root unless it drops privileges.

This is the second time root-owned files under the content root have broken the
running service: B457 was `config.json.bak` files with the same shape and the
same cause.

## Work

- Already done on the box: `chown -R fernscout:fernscout
  /var/lib/fernscout/content/.registry`, then `sudo -u fernscout … npm run
  registry -- reconcile`, which rebuilt 41 email locks and 1 number from disk
  and dropped the stale `armtest-a` entry.
- Find what ran as root. `scripts/deploy.sh` and anything under `scripts/` that
  writes into `CONTENT_DIR` is the place to look; check whether the deploy
  invokes registry reconcile at all, and under whose account.
- Make it not recur rather than fixing the files again. Either every script
  that writes under the content root drops to the service account, or the
  deploy ends with a `chown` sweep over `CONTENT_DIR` — the second is the lazy
  version and catches the case nobody predicted, which is what B457 also wanted.
- `/api/health` has no opinion on whether the instance can write its own
  registry. It could: reserving and releasing a throwaway key is a cheap check,
  and it is the difference between "signup is broken" being found by a ticket
  and being found by a person who cannot sign up.

## Acceptance

- Nothing under `CONTENT_DIR` on the live instance is owned by root.
- A deploy followed by a signup on the live instance completes — the reserve
  step is what proves it.
- Whatever ran as root either no longer does, or is followed by something that
  puts the ownership back.


## Closed, 2026-09-11 — measured, then the owner's word

```
stat -c "%U:%G" /var/lib/fernscout/content/.registry   →  fernscout:fernscout
find /var/lib/fernscout/content/.registry ! -user fernscout | wc -l   →  0
```

Not one file under the registry is owned by anybody but the service account. The
43 root-owned lock files this ticket describes are gone, and with them the
failure they caused — a journal deletion that could not release its lock,
stopping partway with no tombstone, which is what B1175 hardened against today
from the other side.
