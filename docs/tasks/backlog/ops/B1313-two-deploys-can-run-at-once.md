---
id: B1313
title: Two deploys can run at once and leave the site down with a corrupt build cache and a detached HEAD
type: OPS
priority: high
complexity: low
area: deploy, ops
found: "2026-09-10T15:20:01Z"
---

# B1313 — Two deploys can run at once and leave the site down with a corrupt build cache and a detached HEAD

## Why

fernscout.ch was **down for about ten minutes** on 2026-09-10, from roughly
17:09 to 17:19, serving 502 on every path including `/api/health`. It was found
by accident — a before-state capture for another ticket came back `status 502`.

Two deploys were running against the same checkout at the same time:

```
root  1441089  bash ./scripts/deploy.sh --full
root  1441116  runuser -u fernscout -- npm ci
root  1441192  sudo ./scripts/deploy.sh
fern  1441283  sh -c next build
```

One was replacing `node_modules` while the other built against it. The logs show
the collision plainly — first

```
Error: Could not find a production build in the '.next' directory.
```

and then, as `npm ci` emptied the tree under the running build,

```
sh: 1: next: not found
```

Both deploys then died. Nothing was left running, and systemd sat in a restart
loop against a `.next` directory that had a `build/` and a manifest but no
`BUILD_ID`.

**Three separate pieces of damage were left behind**, and each had to be
cleared by hand before the site would come up:

1. **A poisoned Turbopack cache.** The next build attempt panicked with
   `chunk_path requires an asset with file content when content hashing is
   enabled` — an internal Turbopack error, not a code error. Only `rm -rf .next`
   cleared it.
2. **A detached HEAD on the server checkout**, left at `06f9a20b` — the commit
   in `.deploy-state`. `deploy.sh` then failed at its own first step with *"You
   are not currently on a branch"*, so the deploy could not even start. Nothing
   was at risk (HEAD was an ancestor of `origin/main` with no commits of its
   own) but the deploy has no way through it.
3. **A stale `GIT_SHA`.** After a hand-build and restart, `/api/health` reported
   `07a95224` while `67d610c6` was serving — so the one field an operator reads
   to know what is live was wrong, in the middle of an incident.

`scripts/deploy.sh` has no lock. Nothing stops a second invocation, and this
repository is explicitly set up to run several agent sessions at once — AGENTS.md
says so as the reason for the worktree rule. The same reasoning applies to the
deploy and has not been applied to it. B1046 and B1047 record the sibling
problem for `verify` in the shared checkout; this is that hazard on the box
where it takes the site down.

## Work

- Give `deploy.sh` a lock — `flock` on a file under `/srv/fernscout` is the
  smallest thing that works — so a second deploy waits or refuses with a
  sentence naming the running one, rather than interleaving with it.
- Decide which it should be. Refusing is safer and is probably right: a second
  deploy usually means a second session that will report success it did not
  achieve.
- Make the first step survive a detached HEAD, or say what to run. It currently
  fails with git's own message, which does not mention the deploy.
- Recovering from a poisoned Turbopack cache should not need somebody to know
  that `rm -rf .next` is the answer. A build that fails with a Turbopack
  internal error could clear the cache and retry once, saying so.

## Acceptance

- Two `deploy.sh` invocations started together: one completes, the other
  refuses or waits, and the site never serves a 502.
- `deploy.sh` on a detached-HEAD checkout says what is wrong and what to run.
- After any successful deploy, the checkout HEAD, `.deploy-state`, `GIT_SHA` and
  `/api/health`'s `commit` all agree.

## What was done on the box during the incident

Recorded so nobody re-derives it: cleared `.next`, reattached the checkout with
`git checkout main`, built once in isolation as the `fernscout` user, restarted,
then ran `deploy.sh` normally so it wrote its own state. All four markers agree
now, and the only diff between the built commit and HEAD was task files.
