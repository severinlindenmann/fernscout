---
id: B1460
title: B1450's acceptance cannot be checked, because nothing keeps the two numbers it names
type: CHORE
priority: medium
complexity: low
area: helper cost, usage
found: "2026-09-11T12:49:16Z"
---

# B1460 — B1450's acceptance cannot be checked, because nothing keeps the two numbers it names

## Why

Found while trying to give B1450 a live verdict on 2026-09-11. It could not be
given one, and the reason is worth keeping.

B1450's acceptance reads:

> A real turn shows `cache_creation_input_tokens` > 4,096 on the first call and
> `cache_read_input_tokens` > 4,096 on the second.

**Nothing on the running instance keeps either number.** `lib/helper/model.ts`
folds both into one figure at face value:

```
inputTokens:
  (usage?.input_tokens ?? 0) +
  (usage?.cache_read_input_tokens ?? 0) +
  (usage?.cache_creation_input_tokens ?? 0),
```

with a `ponytail:` comment saying exactly that, and B1450 deliberately declined
the usage-table migration that would give them columns — reasonably, since it is
a schema change with no product value at the volume this instance runs at. The
`usage` table has `input_tokens`, `output_tokens` and `seconds`. `journalctl`
carries no cache line either.

**The folded figure cannot tell the two states apart.** A turn whose prefix was
cached and a turn whose prefix was not record the *same* `input_tokens`, because
the cached tokens are added back in at face value. So the acceptance can only be
met by instrumenting a call, never by observing the instance.

That matters more than it looks, because `lib/helper/model.ts:1898` already
names the failure mode this would have to catch: *"Haiku 4.5 will not cache a
prefix under 4,096 tokens and says nothing when it declines — if
`cache_creation_input_tokens` ever comes back zero here, the prefix has been
cut, not the feature broken."* The code knows the silent failure exists and
records nothing that would reveal it. B1053 has since cut the per-turn prefix
from ~11,700 to ~5,600 tokens, which is closer to that floor than anything has
been — so the thing the comment warns about is now one change away rather than
hypothetical.

## Work

The smallest honest thing, not the migration. Options, cheapest first:

- **Log it.** One line at debug level carrying the two counters per call. Costs
  nothing, keeps no schema, and makes the check a `journalctl` grep. Probably
  the right answer.
- A single boolean or small integer on the existing row — "this call read a
  cached prefix" — which is one migration but a trivial one.
- The full two-column migration B1450 named and declined. Only worth it when a
  price turns on it.

Whichever: the point is that somebody can answer "is the cache still working"
without editing code first.

Not in scope: changing how the bill is computed. Folding at face value
overstates slightly and in the safe direction, and that decision stands.

## Acceptance

- A person with shell access can tell, from what the running instance keeps,
  whether a given turn's prefix was written to cache or read from it.
- A prefix that falls under 4,096 tokens is visible as something, rather than
  as an unchanged bill.
- `npm run verify` clean.
