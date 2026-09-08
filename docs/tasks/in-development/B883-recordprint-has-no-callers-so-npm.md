---
id: B883
title: recordPrint has no callers, so npm run verify is red on main
type: ISSUE
priority: medium
complexity: low
area: photobook
found: "2026-09-07T18:00:21Z"
started: "2026-09-08T21:27:12Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T21:27:12Z"
---

# B883 — recordPrint has no callers, so npm run verify is red on main

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`npm run verify` fails its fifth step on `main`:

```
Unused exports (1)
recordPrint  function  lib/photobook/orders.ts:356:23
```

`recordPrint` is exported and called by nothing anywhere in the repository —
`git grep recordPrint` finds only its own definition. It arrived in
`cf4cac61` ("Photobook: print state on the order that was built") beside
`claimForPrint`, which *is* called, so this looks like one half of the Gelato
submission path landing before the other rather than dead code somebody forgot.

Caught while merging B867, whose own branch was green on all five. Not that
ticket's doing and deliberately not fixed there: deleting a function that is
plainly one half of somebody's work in flight is not a merge's business.

## Work

Whoever owns the Gelato path decides which it is:

- **The caller is still coming** — then this is a `knip.jsonc` entry with a note
  saying what it is waiting for, and a task for the other half.
- **It was superseded** — then delete it, and check `claimForPrint` still has a
  reason to exist without it.

Dropping the `export` keyword is the usual answer for an unused export in this
repository, and it is the wrong one here: nothing inside the file calls it
either, so it would trade a knip failure for an eslint one.

## Acceptance

`npm run verify` passes all five steps on a clean `main`.
