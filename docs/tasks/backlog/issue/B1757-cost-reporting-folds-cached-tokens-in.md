---
id: B1757
title: Cost reporting folds cached tokens in at face value, so every figure overstates
type: ISSUE
priority: medium
complexity: low
area: helper, admin
found: "2026-09-15T05:34:21Z"
---

# B1757 — Cost reporting overstates, because cached tokens count at face value

## Why

`lib/helper/model.ts:book` already says so, in a `ponytail:` comment: cache
reads and cache writes are added to `inputTokens` at full price, where a read
actually bills at 0.1x and a write at 1.25x. Overstating was chosen as the
safe direction for an operator's own bill, and the honest fix was named as a
migration nobody had a reason to do yet.

There is a reason now. `npm run helper:bench` prints what a sweep cost from
these same rows, and B1450's whole point is that the ~10,800-token prefix is
cached — so the figure on screen is mostly priced at ten times what it is
really charged. A number that exists to let somebody decide whether to run
something again has to be roughly right, and "safely too high" stops being
safe once it is the number people budget from. The same applies to `/admin`,
where an operator reads it as their bill.

## Work

- Columns of their own on `usage` — `cache_read_input_tokens` and
  `cache_creation_input_tokens` — and a migration, which is what the comment
  already predicted this would take.
- Price them at their real multiples wherever `inputPerMillionRappen` is
  applied today (`lib/instanceCosts.ts`, the bench's own report).
- Old rows have no split and must keep reading as they do now; a total that
  silently changed for last month would be worse than one that is high.

## Acceptance

- A turn on a warm cache reports a cost near what Anthropic actually charges,
  not ten times it.
- `/admin` and the bench agree, because they read the same rows the same way.
- Rows written before the migration still total as they did.
