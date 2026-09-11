---
id: B1429
title: An incremental deploy can leave a stale client reference manifest and 500 a page
type: OPS
priority: high
complexity: medium
area: scripts/deploy.sh
found: "2026-09-11T08:30:00Z"
started: "2026-09-11T08:42:03Z"
session: 975594e4-e8d1-4286-bab8-0faa7d0d368f
claimed: "2026-09-11T08:42:03Z"
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

## What was found

**The cause was not reproduced, and the ticket is honest about that.** What is
known: the same commit, built a second time, wrote the missing file and served
the page. So it is a build that did not finish what it started rather than a
fault in the code that was deployed, and `--full` was not the ingredient —
building again was.

**What was found instead is a way to see it, and it is exact.** Next writes a
`page_client-reference-manifest.js` beside every `page.js` it builds. On a
healthy build of this repository that holds for all 57 pages — checked on the
live box and again locally. On the broken build it did not hold for
`/[user]/contacts`, which is the route that 500'd.

That is a better check than the smoke test this ticket first proposed, for a
reason worth writing down: **the page that broke was owner-only.** A deploy
has no credential, so no unauthenticated page fetch would ever have touched
`/[user]/contacts`. Reading the artefacts needs no session, covers every route
including the gated ones, keeps no route list in step with the app, and takes
under a second.

## What was built

- **`scripts/check-build.mjs`** — walks `.next/server/app`, names every page
  whose manifest is missing, exits 1. Exits 2 on a directory with no pages in
  it, which is a different fault and must not read as a pass.
- **`scripts/deploy.sh`** runs it immediately after the build and **before the
  restart**, so a bad build never reaches the site. If it fails, the deploy
  builds again — the remedy the incident itself proved — and checks again. If
  the second build is also incomplete it exits non-zero with the routes named,
  having restarted nothing, so the previous build keeps serving.
- Deliberately **not** `rm -rf .next` before the retry: the running site is
  still reading out of that directory, and clearing it would take the healthy
  old build down to fix a new one nothing has restarted onto yet. The error
  message suggests that by hand, for the case a rebuild is not enough.

## Not done

The prevention half. Nobody knows yet what leaves `.next` incomplete, and
guessing at it would be a change nothing can show is needed. If this fires
again, the deploy output will now say which routes and when — which is the
evidence that question needs.

## Acceptance

A deploy that produces a build missing a page manifest fails, restarts
nothing, leaves the previous build serving, and names the route. Verified:

- `npx vitest run test/check-build.test.ts` — four tests, including that the
  deploy calls the check *before* the restart line rather than after it.
- Against a real build in this worktree: 57 pages, all present. Removing
  `.next/server/app/[user]/contacts/page_client-reference-manifest.js` — the
  exact artefact that was missing on 2026-09-11 — makes it exit 1 with
  `/[user]/contacts` named; putting it back makes it pass again.
- `npm run verify` — all five steps.

**Deploying this takes two deploys** (the vps skill's own warning): the
running `scripts/deploy.sh` pulls its replacement partway through and bash
reads a script incrementally, so the check first runs on the deploy *after*
the one that ships it. Judge the second.
