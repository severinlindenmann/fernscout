---
id: B1429
title: An incremental deploy can leave a stale client reference manifest and 500 a page
type: OPS
priority: high
complexity: medium
area: scripts/deploy.sh
found: "2026-09-11T08:30:00Z"
---

# B1429 — An incremental deploy can leave a stale client reference manifest and 500 a page

## Why

Seen on the live instance on 2026-09-11, immediately after an ordinary deploy
of a batch of merged tickets (commit 30185774f480):

```
GET /example/contacts -> 500
Error [InvariantError]: Invariant: The client reference manifest for route
"/[user]/contacts" does not exist. This is a bug in Next.js.
```

The deploy reported success at every step and `/api/health` said `ok`, because
health does not render a page. The owner's own contacts page was down and
nothing said so. `.claude/skills/vps/ship.sh --full` fixed it outright — the
same commit, rebuilt from clean, served the page at 200 — so this is a stale
build artefact in `.next/` surviving an incremental build, not a fault in the
code that was deployed.

The fast path (B258) is what makes a deploy twenty seconds instead of five
minutes and is worth keeping. What is not acceptable is that its failure mode
is a 500 on a page nobody checks, with a green deploy and a green health check
in front of it.

## Work

Two separable questions, and the first is the cheap one.

- **Detect it.** The deploy already waits for health. Health proves the
  process is up and proves nothing about a rendered route. Add a small set of
  real page fetches after the restart — one server-rendered page with a client
  component in it is enough to catch this class — and fail the deploy on a
  5xx so the old build stays up. Which pages, and whether any of them need a
  credential, is the design question.
- **Prevent it.** Find out which step leaves `.next/` half-stale. The likely
  candidate is a build over an existing `.next` where a route's client
  manifest was not rewritten; clearing that directory before a code build, or
  only when the route graph changed, may be the whole fix. Measure the cost
  before choosing — the fast path exists for a reason.

Not doing: removing the fast path.

## Acceptance

A deploy that produces a broken route fails, leaves the previous build
serving, and names the route in its output. Reproduce first: find the input
that recreates the stale manifest, or say honestly that it could not be
reproduced and that the check is the whole deliverable.
