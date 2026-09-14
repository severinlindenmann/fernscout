---
id: B1700
title: content-model.json still describes v1 content — md filenames, frontmatter prose, start/end, no declined
type: ISSUE
priority: high
complexity: high
area: api, content model
found: "2026-09-14T09:05:00Z"
---

# B1700 — content-model.json still describes v1 content

## Why

`/content-model.json` is the document a client fetches to learn the *shape* of
a journal on disk — the helper in `fernscout-helper` interprets it to inspect a
private journal on somebody's laptop. B1676 found its `doors` section naming
dead v1 routes and that is fixed (D22). The rest of the document was not, and
it is the larger half.

Compare what it declares against a real journal on this instance today:

| `content-model.json` says | `content/example` has |
| --- | --- |
| `trip.md`, `costs.md`, `plan.md`, `entries/YYYY-MM-DD-slug.md` | `trip.json` — `costs` and `plan` are sections of it |
| trip: `start`, `end` | `dates` |
| `intro` — "the prose under the frontmatter" | `intro`, a key in JSON; there is no frontmatter |
| config: `startLocation`, `defaultLocale`, `features`, `media`, `travellers` | none of them; `figures` instead |
| nothing about `declined` | every trip and day carries it — it is the contract |

`FileName` in `lib/contentModel/types.ts` is a union of the five v1 filenames,
so the staleness is in the type as well as the data, and `rules`, `named` and
`doors` are all keyed by it.

**Why this is worse than an out-of-date document.** A client that interprets it
literally — which is what it is published for — will look for files that are
not there, miss the one key (`declined`) that v2's whole contract is built on,
and report a correct journal as malformed. `test/content-model.test.ts` passes
throughout, because it checks the document against `lib/validate/*`, and those
validators are v1's too.

## Work

A decision first, because the two answers lead to different work:

1. **Regenerate from the v2 Zod schemas.** `lib/api/v2/schemas/` already
   describes every file's real shape; the document becomes a projection of it
   in the closed `assert` vocabulary. Keeps B1577's two-way gate — the reason
   `doors` survived (D22) — and keeps one address for the fact.
2. **Retire the route.** `/api/v2/openapi.json` is generated from the same
   schemas and answers "which call writes this field". This is what
   `docs/v2-migration/02-plan.md` implies. It costs B1577's gate, which is
   about a client in another repository and has no v2 replacement — so
   whatever replaces it has to be named before this is chosen.

Either way `FileName`, the `rules`, the `named` checks (`day-answers-tracked-
fields` still needs `tracks:`, retired) and `lib/contentModel/types.ts`'s prose
move together.

## Acceptance

Every filename and key the document declares exists in a real v2 journal, and
every key a real v2 journal carries is declared — or the route is gone and the
thing that replaces B1577's gate is named and built.
