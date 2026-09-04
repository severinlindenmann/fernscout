---
id: B04
title: Rate-limit state is per-process, in memory, and only swept on one path
type: ISSUE
priority: low
complexity: medium
area: rate-limiting
found: "2026-09-01"
started: "2026-09-04T06:50:26Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T06:50:26Z"
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

## What the Why missed

The sweep does not only fail to run from the namespaced door. **When it does
run, it judges every bucket by the wrong window.** Eviction tested
`now - t >= WINDOW_MS` — the default ten minutes — against every key in the
shared map, and the namespaced buckets do not share that window: nine of the
twelve run fifteen minutes and two run an hour. So an hourly limit looked
expired after eleven minutes and was deleted, which resets it.

That is a bypass, not untidiness, and it is why the sweep could not simply be
moved into a shared helper as it stood — doing that would have run the wrong
comparison from twelve more call sites. Captured separately as **B222**, and
closed by the same change, because there was no way to do this task's Work
without it.

## Work

Done: the sweep is in a `sweep()` helper, and both public functions now go
through a single `take()` that calls it.

- Each bucket stores the window it is counted over
  (`{ times, windowMs }`), and eviction compares against *that* window rather
  than a constant. B222.
- `take()` sweeps on the refusal path too. The old sweep sat below an early
  return, so the one caller certain to be hammering an endpoint — the one being
  refused — was the one that never pruned.
- A sweep runs at most once a second. Without that guard, a map held above the
  threshold by live traffic re-scans every key on every request, so the moment
  the counters are under load is the moment each request costs an extra five
  thousand comparisons. The map can grow by one second of new addresses between
  scans, which is the trade.
- `rateLimit` and `rateLimitFor` are now two lines each. They were two copies
  of the same seven, and the copies had already drifted — only one of them
  swept, which is this ticket.

**Persistence is still not done, deliberately**, and the reasoning in the Why
stands: a per-request write to Postgres to count a reaction is a real cost, the
current design is a trade rather than an oversight, and nothing enqueues work
to `fernscout-worker` yet. Revisit when there is a second process. Nothing was
added to `lib/db/`.

`trackedBuckets()` is new, and is the only addition to the module's surface: a
read-only count, so eviction can be asserted rather than reasoned about.
Nothing in the application calls it.

## Acceptance

`test/rate-limit.test.ts`, five cases. Three of them fail against the code as it
stood:

- **"a namespaced bucket prunes expired keys with no rateLimit() call at all"** —
  5100 keys written entirely through `rateLimitFor`, the windows allowed to
  close, one more call. Before: 5102 buckets, for as long as the process lived.
  After: 1.
- **"a bucket whose own window is still open is not swept away by a shorter
  one"** — five journal-creation attempts (5 per hour), eleven minutes, then a
  map filled past the threshold. Before: the sixth attempt inside the hour was
  *allowed* — `expected false, received true`. After: refused. This is B222.
- **"a refusal sweeps too"** — the refused caller now prunes.

And two that passed before and after, which is the point of them — the limits
themselves are unchanged:

- a household on one address gets sixty in ten minutes and is refused on the
  sixty-first, with a `retryAfter` inside the window;
- a namespaced bucket keeps its own max and its own window: still refused at
  eleven minutes, allowed again after the hour.
