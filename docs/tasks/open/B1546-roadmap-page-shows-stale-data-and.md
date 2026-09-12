---
id: B1546
title: Roadmap page shows stale data and is hard to scan
type: CHORE
priority: low
complexity: low
area: docs, roadmap page
found: "2026-09-11T22:29:57Z"
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

Separately, the page (`getRoadmap()` in `lib/roadmap.ts`) is unfiltered and
unstyled for scanning: every lane, every type (`FEATURE`, `ISSUE`, `CHORE`,
`OPS`, `DOCS` — `SECURITY` is already excluded), one wide table with
generous row padding. At ~1,500 tasks that is a lot to page through to find
what a reader actually came for — the features being built.

## Work

**Staleness**: instrument or trace why a deploy doesn't show up immediately —
check `scripts/deploy.sh`'s release/symlink handling, any `Cache-Control` /
CDN layer in front of the Next app, and whether Next's full route cache is
somehow still applying despite the dynamic `cookies()` read (e.g. a wrapping
layout or `generateStaticParams` upstream). Fix at the actual cause, not by
adding a blanket `export const revalidate = 0` without knowing why it's
needed.

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

- A deploy to fernscout.ch is reflected on `/docs/roadmap` without a manual
  cache-bust — verified by comparing task counts before/after a real deploy.
- Default view lists `FEATURE` tasks only; a visible control switches to
  showing the other types, each with a short contextual line.
- The page reads noticeably more compact at the same viewport — narrower rows,
  large lanes collapsed by default.
