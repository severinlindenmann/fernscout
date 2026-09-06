---
id: B635
title: Search finds nothing on a trip the reader is allowed to read
type: ISSUE
priority: high
complexity: medium
area: search, visibility
found: "2026-09-06T17:51:46Z"
---

# B635 — Search finds nothing on a trip the reader is allowed to read

## Why

Searching a journal as its owner, on a `private` trip, returns nothing. That is
not a bug in the query — it is the design: `buildDocs()` in `lib/search.ts:23`
skips any trip `isIndexable()` refuses, which is every `guest`, `private` or
unlisted trip, and `app/[user]/search-index.json/route.ts` prerenders that
public index at build time so the browser can search a static asset.

The discipline is right for a *public* index — a guest trip's words must not be
in a file anyone can fetch. What is missing is any search at all for a reader
who is entitled to more: the owner sees nothing of their own private trip, and
a buddy sees nothing of the trip they are on.

## Work

- Decide the shape first, and write it down before building: a prerendered
  public index plus a server-side search for a signed-in reader is the obvious
  answer, since `buildSearchIndex()` already exists for server-side use and
  `readFor` in `lib/tripGate.ts` already answers what a reader may see.
- Whatever the shape, the visibility rule is per trip and per entry, evaluated
  against this reader on this request — never a wider index handed to a browser
  and filtered there.
- B632 adds per-day visibility. This must filter at the same grain, or a guest
  entry becomes findable the day B632 lands.
- The static public index stays as it is for a signed-out reader; do not make
  the anonymous case slower to fix the signed-in one.

## Acceptance

- The owner searching their own `private` trip finds its days.
- A person on a trip finds that trip's days and no other closed trip's.
- Signed out, the same searches find only what `isIndexable` allows, and the
  prerendered JSON still contains nothing else.
