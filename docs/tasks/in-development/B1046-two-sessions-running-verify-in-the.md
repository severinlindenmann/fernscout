---
id: B1046
title: Two sessions running verify in the shared checkout collide on the next build lock
type: DOCS
priority: low
complexity: low
area: AGENTS.md, scripts/verify.mjs
found: "2026-09-09T06:44:47Z"
started: "2026-09-11T14:51:58Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T14:51:58Z"
---

# B1046 — Two sessions running verify in the shared checkout collide on the next build lock

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`next build` takes a lock. Two sessions running `npm run verify` in the same
checkout — which is normal here, since several agents work at once and the
shared checkout is where merges are verified — and the second one dies with

```
⨯ Another next build process is already running.
  Suggestion: Wait for the build to complete.
```

`scripts/verify.mjs` then prints its own *"build failed. Stopping here — this
tree is not ready"*, which is the wrong conclusion: the tree is fine and the
lock is held. That reading cost two full re-runs in one session on 2026-09-09,
and the honest readings available to the next agent are "my merge broke the
build" or "the documentation is wrong". Neither is true.

`AGENTS.md` warns about two sessions *editing* the shared checkout and says
nothing about two sessions building it.

## Work

Two small things, and neither is a lock of our own:

- `scripts/verify.mjs` — when the build's output carries "Another next build
  process is already running", say *that* instead of "this tree is not ready",
  and suggest waiting rather than reading the diff.
- `AGENTS.md` — one sentence beside the worktree rules: a verify in a worktree
  and a verify in the shared checkout do not collide (separate `.next`), but
  two in the same checkout do.

Not doing: serialising builds, a lock file of our own, or a retry loop. Waiting
is the right answer and a person can read the message and wait.

## Acceptance

Start a build, then run `npm run verify` in the same checkout while it runs.
The message names the other build.
