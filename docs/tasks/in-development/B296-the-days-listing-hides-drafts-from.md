---
id: B296
title: The days listing hides drafts from the only caller allowed to see them, so an agent cannot audit its own writes
type: ISSUE
priority: high
complexity: low
area: api, entries
found: "2026-09-04T13:48:47Z"
started: "2026-09-04T13:49:17Z"
session: 986bc24c-6a18-473f-a506-aa8c4efb475c
claimed: "2026-09-04T13:49:17Z"
---

# B296 — The days listing hides drafts from the only caller allowed to see them, so an agent cannot audit its own writes

## Why

Reported 2026-09-04 by an agent that had just written fifteen days:

> After a slug collision, the failed draft can linger unnoticed. … the
> *original* attempt stayed as an orphaned draft — invisible in the days list
> endpoint, but visible to the owner on the site. I only found it because the
> owner spotted a duplicate entry on the page.

Confirmed, and the mechanism is one missing argument.
`app/api/v1/[user]/trips/[trip]/days/route.ts:47` calls `getAllEntries(ref)`
with no options, and `visible()` (`lib/entries.ts:100-102`) filters out
anything with `draft` set unless `includeDrafts` is passed. So an agent that
has just created fifteen drafts asks the trip for its days and is handed **an
empty array**.

That is not merely unhelpful, it is misleading in the direction that causes
work. Everything this API writes is a draft, by design and on purpose — so the
listing for a trip is blank for exactly as long as the agent is the only one
who has touched it, and then fills up as the owner publishes. An agent checking
whether its own write landed sees nothing and reasonably concludes nothing
landed.

**There is no visibility argument for hiding them here.** The route is already
behind `authenticate` plus `ownsUser` plus `mayWriteTrip` — the caller is the
owner or somebody on the trip, which is precisely who is allowed to see drafts.
The filter is doing no work except denying information to the one party
entitled to it. `entrySummary` does not carry a draft flag either, so even a
mixed list could not be read.

`GET /api/v1/<user>/drafts` does exist and does list them, journal-wide and
correctly trip-scoped since B91. So the information is reachable — from a
different endpoint the agent had no reason to look at while working on one
trip. That makes this a defect in the obvious endpoint rather than a missing
feature.

## Work

- **Include drafts in `GET .../days`** — `getAllEntries(ref, { includeDrafts:
  true })`. The gate above it already establishes the caller may see them.
- **Say which is which.** `entrySummary` (`lib/api/entries.ts:816`) carries no
  status. Add it, following the file's own convention that a flag is present
  only when true (`test` does this, and the comment above `entrySummary` says
  why) — so a draft is marked and a published day is unmarked, rather than
  every day growing a field.
- **Check every other caller of `entrySummary` and `getAllEntries` first.**
  `entrySummary` feeds at least the day read and the trip summary; a new key is
  cheap but a *changed list* is not. Reading paths that serve the public site
  must not start including drafts — `visible()` is the guard the whole public
  side depends on, so change the call in this one route, never the default.
- Add a test that a draft appears in this listing marked as one, and a test
  that a public reading path still does not see it. The second matters more.

**Documentation is deliberately out of scope here** and rides with B267, which
is next in the same two generated files — this branch must not touch
`lib/api/documentation.ts` or `lib/api/agentCopy.ts` while another session
holds them.

Also not in scope, from the same report: a one-line note that days take no
`translations` field. B294 is about to make that false, so do not write it.

## Acceptance

- An agent that writes a day and then lists the trip's days sees it, marked as
  a draft.
- A published day in the same list is not marked.
- No public reading path — page, feed, sitemap, search — starts including
  drafts; asserted by a test.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
