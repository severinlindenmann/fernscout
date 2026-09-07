---
id: B716
title: No way to browse or search by a single tag on the site
type: FEATURE
priority: low
complexity: low
area: search, tags
found: "2026-09-07T11:31:55Z"
---

# B716 — No way to browse or search by a single tag on the site

## Why

B05 made `tags:` findable through free-text search — searching `wildlife`
finds the entries tagged with it. There is still no dedicated way to browse
*by* a tag: no chip rendered on a day, and no `/<user>/search?tag=…` that a
reader (or a link from elsewhere on the site) could point at to list every
entry carrying one label. B05's own Work section named this explicitly as
item 4 and asked that it be a separate decision — this is that capture.

## Work

Undecided — this is a capture, not a plan. At minimum: a tag chip on a day
page (and/or the search result list), each chip linking to a tag-filtered
view; and a `/<user>/search?tag=…` route or query param that pre-filters
`SearchBox` (or a server-rendered list) to entries carrying that tag, subject
to the same visibility discipline `buildDocs`/`buildDocsForReader` already
enforce.

## Acceptance

TODO once scoped — at minimum, a reader following a tag link sees only
entries actually carrying that tag, and only the ones they were already
allowed to read.
