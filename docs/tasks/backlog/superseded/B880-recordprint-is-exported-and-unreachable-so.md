---
id: B880
title: recordPrint is exported and unreachable, so knip fails verify on main
type: CHORE
priority: medium
complexity: low
area: photobook, build
found: "2026-09-07T19:55:00Z"
superseded: fixed by the Gelato session while this was being written — knip is green
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

## Superseded, 2026-09-07

Both halves resolved by other sessions while this was open, which is the right
outcome and worth recording rather than deleting.

**The code**: the session working on Gelato unexported it —
*"Unexport recordPrint, which nothing calls"* — which is exactly the remedy
`AGENTS.md` prescribes for this finding. `npm run unused` now exits 0 on
`main`. I deliberately did not touch `lib/photobook/orders.ts` myself: it was
dirty in the shared checkout at the time, meaning that session was inside it,
and deleting a function from under an active edit is how two sessions produce
one broken merge.

**The documentation** was already right. My reading of it was stale: the text
I quoted — *"unused exports it prints without failing; there are about a
hundred and thirty"* — had since been replaced with a paragraph that says
exports **do** fail and names the fix. So the guide and `knip.jsonc` agree,
and the premise of this ticket's second half was mine being out of date rather
than the repository being inconsistent.
