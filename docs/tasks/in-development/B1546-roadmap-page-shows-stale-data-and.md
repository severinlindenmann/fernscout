---
id: B1546
title: Roadmap page shows stale data and is hard to scan
type: CHORE
priority: low
complexity: low
area: docs, roadmap page
found: "2026-09-11T22:29:57Z"
started: "2026-09-12T09:08:46Z"
session: 9f435a39-d903-4469-aea7-a258f7052b66
claimed: "2026-09-12T09:08:46Z"
---

# B1546 — Roadmap page shows stale data and is hard to scan

## Why

`app/docs/roadmap/page.tsx` (B675) reads `docs/tasks/` fresh per request —
`requestLocale()` calls `cookies()`, which already forces dynamic rendering,
so nothing here is statically cached at the route level. The owner has
observed `https://fernscout.ch/docs/roadmap` showing stale data even after a
deploy anyway, which means something upstream of the route — a full route
cache Next still applies despite the dynamic API, a CDN/proxy cache header, or
the deploy script's release-directory swap not being what's actually serving
requests — is holding an old render. Find which one it actually is before
fixing it; do not assume.

**Traced, and it is none of those.** `cacheComponents` is off
(`config-shared.js` defaults it to `false`, and `next.config.ts` never sets
it), so this checkout is on Next's "previous model", where a Request-time API
(`cookies()`, read inside `requestLocale()` on every render) opts the whole
route into dynamic rendering the ordinary way — no full route cache applies.
`deploy/fernscout.caddy` sets no cache headers of its own and just proxies;
`next.config.ts`'s own `headers()` block pins `no-store` on `/api/v1`,
`/api/auth`, `/:user/contacts` and `/:user/me` only — `/docs/roadmap` gets
none, but nothing before it can be caching a document that is generated fresh
every request from the runtime API alone. `scripts/deploy.sh` always runs
`git pull --ff-only` regardless of what `classify()` decided about
build/restart, so a plain `docs/tasks/*` change reaches the checkout on disk
even on a deploy that skips the build — confirmed by reading `getRoadmap()`
in `lib/roadmap.ts`, which calls `fs.readFileSync` per request with nothing
memoized at module scope to go stale.

What actually explains "stale after a deploy": `curl -fsS
https://fernscout.ch/api/health` reports the live instance serving
`0f6d3a64`, which is exactly `origin/main`'s tip
(`git merge-base --is-ancestor` holds, zero commits between them) — the
deploy pipeline is doing precisely what it is documented to do. This
checkout's own local `main`, at the time of writing, sits 13 commits ahead of
`origin/main` — ordinary lane-move and in-progress work that had not been
`git push`ed yet. `deploy/ship.sh` and `scripts/deploy.sh` both only ever pull
from `origin`; nothing pushes automatically (`AGENTS.md`'s task section: task
files "commit straight to `main`", not "commit and push"). So the sequence
that produces exactly the symptom reported is: task lane moves and other work
land on local `main`, a deploy runs before anyone pushes them, and the
roadmap — correctly — shows what `origin/main` actually has. That is not a
caching bug anywhere in this stack; it is `git push` being a separate,
easy-to-forget step from "a deploy ran".

Separately, the page (`getRoadmap()` in `lib/roadmap.ts`) is unfiltered and
unstyled for scanning: every lane, every type (`FEATURE`, `ISSUE`, `CHORE`,
`OPS`, `DOCS` — `SECURITY` is already excluded), one wide table with
generous row padding. At ~1,500 tasks that is a lot to page through to find
what a reader actually came for — the features being built.

## Work

**Staleness**: no code change — see Why. There is no cache to bust: the route
is dynamic, the proxy sets no cache headers, and `git pull` always runs on
deploy regardless of the build/restart decision. The reported staleness was
`origin/main` lagging local `main` by unpushed commits, which a deploy cannot
fix by definition (it pulls from `origin`). Nothing here is a `revalidate = 0`
gap to add.

**Compactness**: tighten table row padding/font size, drop or shrink whichever
column reads as least useful once features are the default view (probably
`Type`, since it becomes redundant when everything shown is `FEATURE` by
default), and collapse lanes with large counts (backlog, completed) behind a
toggle that still shows the count.

**Filtering**: default view shows only `type: FEATURE` tasks, across lanes.
Add a filter control that reveals the rest (`ISSUE`/`CHORE`/`OPS`/`DOCS`) when
toggled on, and give each of those rows a short bit of context beyond the bare
title — e.g. the task's `area` field, or the first line of its `Why` section
if that's cheap to read alongside `getRoadmap()`'s existing frontmatter-only
read (extending `RoadmapTask`/`readTask` to pull one more field, not the whole
body — the page still must not publish full task bodies per B675's own
reasoning about security-finding prose).

Not doing: no per-task page, no change to what `SECURITY` filtering excludes.

## Acceptance

- Staleness: no code fix, since none is needed — the trace in Why is the
  evidence (`/api/health`'s served commit matches `origin/main`'s tip exactly,
  with no route or proxy cache in between).
- Default view lists `FEATURE` tasks only; a visible control switches to
  showing the other types, each with a short contextual line.
- The page reads noticeably more compact at the same viewport — narrower rows,
  large lanes collapsed by default.
