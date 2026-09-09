---
id: B896
title: The unused gate keeps going red on exports nobody notices
type: CHORE
priority: medium
complexity: low
area: tests, ci
found: "2026-09-07T19:00:55Z"
started: "2026-09-08T00:00:00Z"
merged: "2026-09-08T05:03:08Z"
completed: "2026-09-09T16:47:50Z"
---

# B896 — The unused gate keeps going red on exports nobody notices

## Why

`npm run unused` is red on `main` again, and this is the fourth recording of
one shape: B880 and B881 (duplicate captures of each other) and then B883 were
all `recordPrint`, exported and unreachable. Today it is `defaultSizeFor` in
`lib/photobook/spec.ts:122` — a fallback size for the photobook wizard that
nothing in the repository calls, not even its own file.

Knip is the last step of `verify` since B24, so a branch cannot introduce this
on its own. What introduces it is the **merge**: a branch exports a symbol its
own new caller uses, another branch removes or rewrites that caller, git merges
both cleanly, no test fails, and `main` is red with nobody having done anything
wrong on their own branch. The `work-on-a-task` skill already says to verify
again after merging; a two-minute `verify` after a two-minute merge is the step
that gets skipped, and this is the one check that a clean merge actually
breaks.

## Work

- Delete `defaultSizeFor`. It is not a dropped `export` on live code — nothing
  calls it at all, in any file, so the code is what is dead.
- Name the cheap check in `work-on-a-task`'s merge step: `npm run unused` is
  two seconds and is what a clean merge breaks, so it is the one thing to run
  on `main` even when the full `verify` is skipped.

Not doing: a git hook. Hooks here are gitignored per-machine configuration
(AGENTS.md), so a hook would fix this checkout and no other.

## Acceptance

`npm run unused` exits 0 on `main`.
