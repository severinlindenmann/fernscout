---
id: B890
title: Search indexes only days and four nav rows — trips, docs pages and journal destinations are unfindable
type: FEATURE
priority: medium
complexity: medium
area: search
found: "2026-09-07T18:25:54Z"
started: "2026-09-07T18:26:31Z"
session: 6c81e17b-6acf-4c0f-86ef-49124c9b2458
claimed: "2026-09-07T18:26:31Z"
---

# B890 — Search indexes only days and four nav rows — trips, docs pages and journal destinations are unfindable

## Why

`lib/search.ts` indexes exactly two things: every day a reader may open, and
four trip-scoped nav rows (Story, Gallery, Map, Analytics) plus the owner's
account page. Everything else this site renders is unreachable from `/search`:

- **Trips themselves.** A trip's title, tagline and intro prose are indexed
  nowhere. Searching a trip's name only finds it obliquely, through the
  `tripTitle` field of its days — and a trip whose days are all drafts, or that
  has none yet, cannot be found at all.
- **The documentation.** `DOCS_PAGES` — three reader guides plus four technical
  pages — is a public part of this site with no row in any index. The guides in
  `docs/guides/<locale>/` are prose written for exactly the reader who is
  most likely to be searching for it ("how do I sign in", "wie werde ich
  benachrichtigt") and none of those words are indexed.
- **Journal-scoped destinations.** `/trips` and `/me` are in the header for
  every reader and in no index; `/contacts` is the owner's own page and in
  neither.

The reported symptom is narrower and is the same shape: searching *Preis* on a
German journal returns nothing, because `search.analyticsTerms` names Kosten,
Ausgaben and Budget but not the most ordinary German word for what a thing
costs.

The permission story is already right and this must not touch it: B635's two
builders (public via `isIndexable`, reader-scoped via `mayReadTrip`/`readFor`)
are the discipline every new document kind has to inherit rather than work
around.

## Work

- `lib/navDestinations.ts`: add `JOURNAL_DESTINATIONS` — `/trips` for
  everyone, `/me` for a signed-in reader, `/contacts` owner-only — beside the
  existing trip-scoped list.
- `lib/search.ts`: three new document kinds beside `day` and `page`:
  - `trip`, one per included trip, carrying title, tagline and intro. Built in
    both builders, from the same loop that already decided the trip is in.
  - `doc`, one per `DOCS_PAGES` row, with the guide markdown as its body where
    there is one. Public: added by both builders identically, gated on nothing.
  - the journal destinations above, gated by reader level in the reader builder
    only.
- `site/locales/*.json`: widen `search.analyticsTerms`, add the new labels and
  synonym rows.
- `components/SearchBox.tsx`: render the new kinds' subtitles — a doc says it
  is documentation, a trip shows its dates.
- Not doing: a runtime search service, server-side querying, or ranking
  changes beyond the existing boosts. The index is still built per request and
  searched in the browser.

## Acceptance

- `test/search.test.ts` covers: a trip found by a word only in its intro; a
  guide found by a word only in its markdown; `/contacts` absent from a
  stranger's index and present in the owner's; a `private` trip's trip-row
  absent from the public index.
- On a German journal, searching `Preis` returns the Analytics destination.
- `npm run verify` green.
