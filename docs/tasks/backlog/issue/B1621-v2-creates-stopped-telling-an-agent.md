---
id: B1621
title: "v2 creates stopped telling an agent what comes next — B311's chain was broken by the migration"
type: ISSUE
priority: high
complexity: low
area: API v2
found: 2026-09-12T00:00:00Z
---

## Why

B311 split the agent guide into task-sized documents and wired them into a
**chain**: the reply that creates a journal names `add-a-trip`, the reply that
creates a trip names `add-a-day`, the reply that creates a day names
`ingest-photos`. An agent following the API is handed the next document at the
moment it needs it, rather than having to know the guide exists and go looking.

`grep -rn "skillDocPath" app/api/v2/` returned **nothing**. The v2 routes were
written fresh against the schemas, and the schemas say nothing about a
response's `next` pointer, so the chain simply was not carried across. An
agent that created its first trip through v2 was told nothing about what to do
with it.

This is the same class as B1607 (`/documentation.txt` naming dead routes) and
worth saying plainly: **the network documentation is the product for everybody
not standing in this checkout.** There is no CMS and no source to read. A
migration that moves a route and drops its pointer has removed a feature
without anybody deciding to.

Caught by `test/skill-docs.test.ts` — which encodes exactly this chain and had
to be repointed at the moved routes to keep meaning anything.

**Fixed in B1612's merge.** This ticket is the record and the follow-up.

## What was done

- `PUT /api/v2/{user}/trips/{trip}` answers a **create** with a `next` naming
  `add-a-day`; `PUT .../days/{slug}` answers a create with one naming
  `ingest-photos`.
- Only on a create (`201`). A correction is not somebody's first time, and a
  pointer on every write is noise that teaches an agent to ignore the field.
- `test/skill-docs.test.ts`'s chain assertions now name the v2 routes. The
  pointer lives on the single-trip and single-day routes rather than a
  collection `POST`, because creating in v2 is a `PUT` to the id.

## Work — the part that is deliberately still open

`test/skill-docs.test.ts` also asserts that **every route sending a `next`
pointer documents it**, against `lib/api/openapi.ts`. That file is v1's
document and describes `/api/v1/**` and `/api/auth/**` only; v2's contract is
the Zod schemas, and `/api/v2/openapi.json` is generated from them in **step 6**
of the migration.

So that check is currently filtered to exclude `app/api/v2/**` — not because
the rule stopped applying, but because the document it checks against is the
wrong one. **The obligation moves, it does not disappear:**

- the generator that builds `/api/v2/openapi.json` must carry the same rule —
  a route that sends `next` documents it;
- the filter in `test/skill-docs.test.ts` comes back out at that point.

Both are written into the test's own comment and into
`docs/v2-migration/05-status.md` against step 6, because a filter explained
only in a comment is a filter that becomes permanent.

## Acceptance

- A v2 trip create and a v2 day create each carry a `next` naming the right
  guide. (Done.)
- A v2 *update* carries none. (Done.)
- When `/api/v2/openapi.json` is generated (step 6): the v2 filter is removed
  from `test/skill-docs.test.ts` and the check passes against the new document.
