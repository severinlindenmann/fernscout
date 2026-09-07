---
id: B882
title: recordPrint is exported and nothing reads it, so npm run verify fails on main
type: ISSUE
priority: low
complexity: low
area: Photobook / build gate
found: "2026-09-07T18:00:00Z"
---

# B882 — recordPrint is exported and nothing reads it, so npm run verify fails on main

## Why

`npm run unused` is the last step of `npm run verify`, and on a clean `main`
it fails:

```
Unused exports (1)
recordPrint  function  lib/photobook/orders.ts:356:23
```

Nothing outside that file imports it — a repo-wide grep finds only the
definition. So the gate every task is meant to pass is already red before
anybody starts, which is the worst state for a gate to be in: the next agent
either learns to ignore knip or spends a round working out that the failure
is not theirs. Found while verifying B879, whose diff touches nothing near
photobook.

## Work

Decide which it is, and `git log` on that function is where the answer is:

- The caller was removed and the function is dead → delete it.
- It is still called from inside `lib/photobook/orders.ts` → drop the
  `export` keyword, which is what `AGENTS.md` prescribes for this class of
  knip failure.
- A caller is missing that should exist → that is a different, larger bug and
  this ticket should say so rather than silencing the warning.

Do not add it to `knip.jsonc`'s ignore list. That turns a one-line answer into
a permanent exception.

## Acceptance

- `npm run unused` on `main` reports no unused exports.
- `npm run verify` runs to the end on a `main` with no other changes.
- Whichever branch of the Work was taken is written into this file before it
  moves.
