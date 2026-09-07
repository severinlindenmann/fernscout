---
id: B880
title: recordPrint is exported and unreachable, so knip fails verify on main
type: CHORE
priority: medium
complexity: low
area: photobook, build
found: "2026-09-07T19:55:00Z"
---

# B880 — recordPrint is exported and unreachable, so knip fails verify on main

## Why

`npm run verify` now runs knip as its fifth gate, and knip exits 1 on `main`:

```
Unused exports (1)
recordPrint  function  lib/photobook/orders.ts:356:23
```

Confirmed as **pre-existing on `main`**, not introduced by any branch in
flight — knip exits 1 both on `main` and on a worktree cut from it, with the
identical finding. So every session's `verify` is currently failing at that
step for a reason none of them caused, which is the worst kind of red: it
trains people to skip the gate.

`AGENTS.md` says unused *exports* are printed without failing and that there
are about a hundred and thirty of them (B235's). That is no longer what
happens here, so either the configuration changed or this one is reachable in
a way knip cannot see.

## Work

- Find out which it is first. If `recordPrint` genuinely has no caller, either
  delete it or make it non-exported; if something reaches it dynamically, tell
  knip so.
- Then decide the general question, because it is the one that matters: does
  `verify` fail on unused exports or not? `AGENTS.md` says not. If it now
  does, the document is wrong, or the config is. They must agree — a gate that
  fails for a reason the guide says it does not is how people learn to ignore
  it.

## Acceptance

- `npm run verify` passes on a clean `main` with nothing else changed.
- `AGENTS.md` and `knip.jsonc` agree about whether an unused export is a
  failure.
