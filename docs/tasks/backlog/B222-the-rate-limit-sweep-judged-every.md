---
id: B222
title: The rate-limit sweep judged every bucket by the default window, resetting the longer ones
type: SECURITY
priority: medium
complexity: low
area: rate-limiting
found: "2026-09-04T07:29:26Z"
---

# B222 — The rate-limit sweep judged every bucket by the default window, resetting the longer ones

## Why

Found while doing B04, which is why it is **already fixed** — the fix and the
bug are the same three lines and there was no way to share the sweep without
addressing this. Captured anyway, because it is a distinct vulnerability with
its own reasoning, and because a person verifying B04 should know what they are
looking at.

Every bucket on this server lived in one `Map` in `lib/rateLimit.ts`, and they
do not share a window. The default bucket is ten minutes; nine of the twelve
namespaced callers use fifteen and two use an hour:

| bucket | limit |
| --- | --- |
| `journals-create` | 5 per hour |
| `auth-signup` | 5 per hour |
| `auth-request` | 5 (agent) / 10 per 15 min |
| `contacts-request`, `contacts-redeem` | 5 per 15 min |
| default (reactions, push) | 60 per 10 min |

The eviction inside `rateLimit()` tested every key in the map against the
*default* ten minutes:

```ts
if (hits.size > 5000) {
  for (const [k2, times] of hits) {
    if (times.every((t) => now - t >= WINDOW_MS)) hits.delete(k2);
  }
}
```

So an hourly bucket whose last attempt was eleven minutes ago looked expired,
was deleted, and started again from zero. Deleting a rate-limit counter early
is not housekeeping — it is resetting the limit.

**Two conditions, both reachable.** The scan only runs above five thousand
tracked keys, and only from `rateLimit()` — the reaction and push endpoints,
which are unauthenticated and take an address per caller. Five thousand
distinct addresses is not a barrier to anyone with an IPv6 allocation, and
`clientIp()` keys on whatever the proxy hands over. The result is that the
signup-code and journal-creation limits, which exist to stop somebody working
through a list of addresses, could be cut from an hour to eleven minutes by a
second endpoint the attacker also controls the input to.

Demonstrated rather than argued: `test/rate-limit.test.ts`, "a bucket whose own
window is still open is not swept away by a shorter one", fails against the
code as it stood — the sixth hourly attempt is allowed.

## Work

Done as part of B04. Each bucket now stores the window it is counted over, and
the shared `sweep()` compares against that window rather than a constant:

```ts
type Bucket = { times: number[]; windowMs: number };
if (bucket.times.every((t) => now - t >= bucket.windowMs)) hits.delete(key);
```

Not doing: persisting the counters. That is B04's other half and is deliberately
left alone until there is a second process.

## Acceptance

- `npx vitest run test/rate-limit.test.ts` — "a bucket whose own window is
  still open is not swept away by a shorter one" fails on the pre-B04 code and
  passes now.
- On the live site: five journal-creation attempts, then reactions from many
  addresses, then a sixth attempt inside the hour is still refused.
