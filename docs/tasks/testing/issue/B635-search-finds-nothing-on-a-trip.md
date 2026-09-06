---
id: B635
title: Search finds nothing on a trip the reader is allowed to read
type: ISSUE
priority: high
complexity: medium
area: search, visibility
found: "2026-09-06T17:51:46Z"
started: "2026-09-06T20:04:31Z"
merged: "2026-09-06T20:20:08Z"
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

## Design (written before building)

**One route, branched on whether anybody is signed in — not two routes and not
a new query API.** `GET /<user>/search-index.json` already reads
`resolveAccess(user)`-shaped state indirectly through nothing today; it will
now ask `resolveAccess(user)` itself. No email on the request: build exactly
today's public index (`buildSearchIndexJson`, unchanged, `Cache-Control:
public`). An email present: build a **reader-scoped** index instead
(`buildSearchIndexJsonForReader`), served `Cache-Control: private` — the same
header story.json already uses for the same reason, so this one reader's
answer is never a candidate for a shared/CDN cache and can never be handed to
the next request that reuses the connection or the edge cache. `SearchBox.tsx`
does not change at all: it always fetches the same URL and searches the JSON
it gets back with MiniSearch, same as before. The index shipped to the browser
is never wider than what this one reader may see — it is the *whole* answer for
that reader, not a superset filtered further on the client, so nothing here
violates "never a wider index handed to a browser and filtered there": the
narrowing already happened on the server, per trip and per entry, before the
byte left it.

**Trip inclusion, for the reader-scoped path:** `isIndexable(trip)` first —
everything the public index already carries. Then, for a `guest` or
`private` trip, `mayReadTrip(trip)` — the one function that already asks
"owner, somebody on the trip, or an approved journal contact (for `guest`
only)" correctly, so a `guest`-visibility trip surfaces for an approved guest
too, not only for the owner and the people on it. `mayReadTrip` is
deliberately **not** asked for a `public` trip, because it answers yes for
one marked `listed: false` too — reachable by anyone holding the link,
signed in or not — and search is a discovery surface like the sitemap and
the feed, not an access check. So an unlisted trip is found only by the
owner or somebody on it, the same rule `listableTrips` applies to the trip
switcher; a stranger or an otherwise-approved guest gets nothing extra from
it. `trip.status === "upcoming"` and `trip.test` are excluded first,
unconditionally — B70's rule ("nobody lived it") does not bend for the owner
either, matching `lib/feed.ts`.

**Entry inclusion, for every included trip:** `readFor(trip, request)` — the
same call every other reading path uses — supplies `{ includeDrafts, reader }`
to `getAllEntries`, so a draft and a `guest`/`private`-labelled entry (B632)
are filtered at the exact grain `visible()` in `lib/entries.ts` already
enforces. Nothing about entry visibility is reimplemented here; the read layer
already strips what a reader may not see, so the index built from it is
correct by construction.

**One deliberate asymmetry, worth naming:** the owner can find their own
`visibility: public, listed: false` ("unlisted") trip via search, even though
`listableTrips` deliberately keeps that same trip out of the owner's own trip
switcher. Those are different tools answering different questions — the
switcher declutters navigation the owner chose to hide from itself, search
answers "did I write this" — and this ticket's acceptance never asks the two
to agree. `isIndexable` alone still governs the anonymous path, unchanged, so
a stranger's answer is exactly what it always was.

**Was the public index already correct for B632's per-entry labels?**
Yes — verified. `buildDocs` calls `getAllEntries(trip.ref)` with no
`ReadOptions`, so `reader` defaults to `"public"` inside `visible()`
(`lib/entries.ts:218`), which is the closed default the whole B632 mechanism
leans on. A `guest`-labelled entry on an otherwise-public, listed trip is
therefore already dropped before `buildDocs` ever sees it — B632 needed no
change here, and `test/search.test.ts` plus the new test below assert it
stays that way.

**Why not a query-executing API instead of a bigger index:** the ticket
floats "a server-side search for a signed-in reader" and the simplest thing
that is actually correct is the smallest diff on the existing shape — the
same `MiniSearch` index, built with a different (and always narrower-than-the-
whole-journal) document set, served through the same URL. A route that parses
`?q=` and runs `index.search()` on the server buys nothing: it still has to
build the same reader-scoped index first, and now `SearchBox.tsx` needs two
code paths instead of none.

**Not under `app/api/`, so the AGENTS.md contract rules do not apply.** This
route sits beside `story.json` and the original `search-index.json` — it is
part of the reading surface (same owner, same trip gate, same cookie-only
session), not the agent-facing REST surface, and it takes no bearer token in
practice: `resolveAccess` reads only the two browser cookies, so an agent
authenticating with `Authorization: Bearer` still gets the plain public index,
matching what `/agent.md`/`documentation.txt` already say ("every public
entry, for finding things") — verified, no doc update needed.

**Tests:** `test/search.test.ts` (unchanged, still green — the public path is
untouched) plus a new `test/search-reader.test.ts` covering, over one fixture
of six trips (public listed, public unlisted, guest, two privates — one with
a traveller, one without — and one `test: true`):
- the owner finds their own `private` trip, every closed trip, the unlisted
  one, and the guest-labelled update (acceptance line 1, plus the B632 grain);
- a person on a trip (`buddy-2026`) finds that trip and not the other
  `private` trip, the `guest` trip, or the unlisted one (acceptance line 2);
- an approved journal guest finds the `guest` trip and the guest-labelled
  update on the public trip, never a `private` trip or the unlisted one — the
  B632 acceptance line, both directions;
- a signed-in stranger's reader-scoped index is byte-for-byte the same
  content as the anonymous prerendered one (acceptance line 3);
- the prerendered public JSON stays `isIndexable`-only regardless of who else
  has signed in during the same test run — nothing about the reader-scoped
  path leaks into the shared, cached path.

**Verify:** `npm run verify` — build, `tsc --noEmit`, `eslint .`, `vitest run`
all green (4003 tests passed, 3 skipped Postgres-only, pre-existing unrelated
lint warnings only).
