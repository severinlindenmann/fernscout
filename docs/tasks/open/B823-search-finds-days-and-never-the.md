---
id: B823
title: Search finds days and never the pages, so there is no way to search your way to costs or storage
type: FEATURE
priority: medium
complexity: medium
area: search
found: "2026-09-07T17:40:00Z"
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
