---
id: B823
title: Search finds days and never the pages, so there is no way to search your way to costs or storage
type: FEATURE
priority: medium
complexity: medium
area: search
found: "2026-09-07T17:40:00Z"
started: "2026-09-07T15:37:14Z"
merged: "2026-09-07T16:16:29Z"
---

# B823 — Search finds days and never the pages, so there is no way to search your way to costs or storage

## Why

Asked for: *"search — make sure it is also possible to search for a menu
point, for e.g. cost, storage etc."*

`buildDocs` in `lib/search.ts` walks trips and entries and nothing else, so the
index holds days and only days. Typing "Kosten" or "storage" into
`/<user>/search` returns whatever days happen to mention the word in prose,
and never the costs page or the storage page — which is what somebody typing
it almost always wants. Since B770 put the destinations behind a menu button
on a phone, searching for them is a more reasonable thing to try than it was
when seven icons were on screen.

## Work

- Put the destinations into the index as their own documents, beside the
  entries — title, the words somebody would plausibly type for them, and the
  URL. `useNavEntries()` (`components/SiteNav.tsx`) is the source of what the
  destinations *are*; do not write a second list beside it (that is the rule
  the enum imports in `lib/api/openapi.ts` already follow).
- **Visibility is the part to get right.** The costs page is behind the
  `costs` capability and its own visibility rule; storage and credits are
  owner-only (B821 gives them a page). An index built once and served to
  everybody must not tell a stranger that a journal has a storage page — the
  reader-scoped builders already exist for exactly this
  (`buildDocsForReader`/`buildSearchIndexForReader`), and this has to go
  through them rather than the public one.
- A page result should look like a page, not like a day — a reader scanning
  results should not mistake one for the other.
- Search terms are words a person types, so they are locale strings: all three
  locales, and the synonyms that matter ("Kosten", "Ausgaben", "Budget" all
  meaning the costs page).

Not doing: full-text search of the pages' own rendered content. This is
navigation by name, not another corpus.

## Acceptance

- Searching "Kosten" (and "costs") surfaces the costs page for a reader
  allowed to see it, above or beside the days that merely mention the word.
- Searching "Speicher" surfaces the storage page **for the owner and for
  nobody else** — asserted by a test that builds the index as a stranger.
- The public `search-index.json` gains no owner-only destination.
- Day results are unchanged in shape and ranking against each other.

## Done

`SearchDoc` (`lib/searchOptions.ts`) gained `kind: "day" | "page"` and
`terms: string` (extra words, indexed but never shown — the label plus
any synonyms, in every locale the journal offers). `lib/search.ts`
gained `pageDoc()`, and both `buildDocs` (public) and
`buildDocsForReader` now push one page document per trip-scoped
destination in `lib/navDestinations.ts`'s `TRIP_DESTINATIONS` (Story,
Gallery, Map, Analytics — gated on `analyticsAvailable()`, same
capability check the nav tab itself makes) for every trip already in
that loop, using exactly the gate the loop already applies to that
trip's entries (`isIndexable` for the public builder,
`includeInReaderIndex` for the reader one) — no new visibility
question, which is what keeps this small. `buildDocsForReader` alone
also adds `ACCOUNT_DESTINATION` (B821's `/account`), gated on
`isOwner(username, request)`.

**One simplification from the ticket's own wording, written down here
because it changes what "the costs page" means.** The ticket says
"surfaces the costs page" as if `/costs` were its own nav destination;
it is not — since B557 it lives inside the Analytics hub (`/analytics`),
which owns `/costs` and `/weather` for the nav's active-state logic
(`also`) and is the one thing `useNavEntries()` actually draws. Rather
than inventing a `mayViewCosts()`-gated `/costs` document beside the
Analytics one (a second, narrower visibility question the hub itself
does not ask when deciding whether to *show* its tab), this indexes
the Analytics destination itself, with `search.analyticsTerms`
carrying the costs/budget/weather synonyms
("Kosten"/"Ausgaben"/"Budget"/"Wetter"). Searching "Kosten" finds the
Analytics page, which is where the costs page is; it does not (and
was never asked to) index `/costs` as a URL of its own. Also skipped,
for the same reason of staying tied to what `useNavEntries()` actually
draws rather than adding a parallel list: `/trips`, `/search` and
`/me`, which the nav pushes individually rather than from an array.

`components/SearchBox.tsx` renders a `kind: "page"` result without the
date/location line a day gets — just the title and (for a trip-scoped
destination) the trip's title underneath, or nothing at all for the
journal-scoped account page.

**The visibility proof, live and as a test.** Booted the demo
journal locally with `helper`+`credits`+`mail`+`auth` on, signed in as
the owner (`agent@fernscout.ch`) via the real one-click link, and
compared `GET /example/search-index.json` with and without the
session cookie: public index 46 documents, no `/example/account`
anywhere in it; owner's index 50 documents, `/example/account` present,
and the word "storage" present. Typing "storage" into
`/example/search` as the owner returns a page result titled "Account"
with no date/location line. As a test:
`test/search-reader.test.ts`'s new "the destinations in the index"
block builds the reader-scoped index as the owner, a buddy, an
approved guest and a stranger, and as the anonymous/public builder,
and asserts `/quinn/account` and the word "storage" appear in none of
them but the owner's.

`test/search.test.ts`'s old "a private trip's content is not indexed
at all" test asserted `documentCount < 3` for one public trip with one
entry; it is now `4` (the entry plus that trip's Story/Gallery/Map
page docs — no Analytics, since the fixture carries no costs/weather
data) — updated with a comment explaining why, not just the number.

Committed as `a8eb3b0a B823: search finds the destinations too, not
only days`.
