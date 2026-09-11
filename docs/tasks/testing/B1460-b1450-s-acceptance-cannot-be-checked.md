---
id: B1460
title: B1450's acceptance cannot be checked, because nothing keeps the two numbers it names
type: CHORE
priority: medium
complexity: low
area: helper cost, usage
found: "2026-09-11T12:49:16Z"
started: "2026-09-11T14:10:11Z"
merged: "2026-09-11T14:21:53Z"
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

Done: logged it, at the one place every call already passes through —
`book()` in `lib/helper/model.ts`, which every one of the seven call sites
(`describe_photos`, `write_day`, `map_statement`, `ask_thread` ×3,
`find_in_journal`) already calls with the raw `usage` object before folding
it for `recordUsage`. One `logUsage()` added there, so the line exists for
every call without touching a call site.

Shape: `[helper-cache] <operation> in=<n> out=<n> cache_write=<n>
cache_read=<n>[ <note>]` — a real cold-then-warm pair from an ask_thread turn
would read:

```
[helper-cache] ask_thread in=453 out=612 cache_write=5601 cache_read=0
[helper-cache] ask_thread in=112 out=340 cache_write=0 cache_read=5601
```

Gated on `isEnabled("logging")`, the same operator switch `proxy.ts` already
reads for the request line — this is the mechanism the codebase already has,
not a second one, and it goes silent along with everything else logging
governs when the switch is off. Written with `console.log`, matching every
other `lib/*.ts` line (`[module] message`), not `console.error`/`warn` since
this is not a fault condition.

The near-floor question: yes, a note is appended, but only for `ask_thread` —
the only operation that ever sets `cache_control` (see the `cachedSystem`
comment in `lib/helper/model.ts`). For every other operation a zero on both
counters is the normal, permanent state and would be a false alarm if
flagged. For `ask_thread`:
  - both counters at zero → `cache=not-written (prefix may be under the
    floor)` — the silent-decline failure the `cachedSystem` comment warns
    about, since Haiku 4.5 says nothing when it refuses to cache a prefix
    under 4,096 tokens.
  - a nonzero write under `4,096 × 1.25` (5,120) → `cache=near-floor` — cached
    today, but close enough to the floor that the next prompt trim could push
    it under without any other symptom. B1053 already moved the prefix from
    ~11,700 to ~5,600 tokens, which is why this is worth a distinct signal
    rather than only raw numbers an operator has to do arithmetic on.

Grep an operator would run: `journalctl -u fernscout | grep helper-cache` for
everything, or `journalctl -u fernscout | grep 'helper-cache ask_thread'` to
watch caching specifically — `cache_write` > 4,096 on a cold call and
`cache_read` > 4,096 on the next is B1450's acceptance, now checkable without
editing code.

Not in scope, unchanged: `book()`'s own fold for `recordUsage`/the bill is
untouched. Folding at face value still overstates slightly and in the safe
direction; that decision stands, and this line is a separate, parallel
observation of the same numbers before the fold, not a replacement for it.

## Acceptance

- A person with shell access can tell, from what the running instance keeps,
  whether a given turn's prefix was written to cache or read from it.
- A prefix that falls under 4,096 tokens is visible as something, rather than
  as an unchanged bill.
- `npm run verify` clean.
