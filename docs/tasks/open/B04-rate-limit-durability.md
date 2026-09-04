---
id: B04
title: Rate-limit state is per-process, in memory, and only swept on one path
type: ISSUE
priority: low
complexity: medium
area: rate-limiting
found: "2026-09-01"
---

# B04 — Rate-limit state does not survive, and is swept unevenly

## Why

`lib/rateLimit.ts` keeps counters in a module-level `Map`. That is an honest
choice for one Node process on one VPS, and the file says as much. Two
consequences are worth writing down before they surprise somebody.

**It resets on every deploy.** `scripts/deploy.sh` restarts the service, so
whoever was three attempts into guessing a trip password starts again at zero.
Not urgent at this size, but it means the limit is weakest exactly when
releases are frequent.

**It does not survive a second process.** The moment there are two instances —
or the `fernscout-worker` unit starts serving anything — each keeps its own
counters and the effective limit doubles. Nothing today does this; the unit
exists but nothing enqueues work yet.

**The sweep only runs on one path.** The eviction at `lib/rateLimit.ts:64`
lives inside `rateLimit()`, the default bucket. `rateLimitFor()` — which is
what all twelve namespaced callers use — never sweeps. Both write into the same
`hits` map, so the default bucket does clean up after the namespaced ones *when
it is called*; if it stops being called, nothing prunes and the map grows with
distinct addresses.

## Work

Smallest useful step is the sweep: move it into a helper both functions call,
so eviction does not depend on which door was used.

Persistence is a larger question and probably not worth it yet. If it is
wanted, the database is already there and `lib/repos/` is the shape for it —
but a per-request write to Postgres to count a reaction is a real cost, and the
current design is a deliberate trade, not an oversight. Revisit when there is a
second process, not before.

Depends on nothing, but is close to B01 in the
same file — worth doing in the same pass.

## Acceptance

- A namespaced bucket alone, with no `rateLimit()` calls, prunes expired keys.
- The limits themselves are unchanged: a household sharing one address is still
  well inside the default bucket.
