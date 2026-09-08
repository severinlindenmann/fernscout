---
id: B974
title: Live search: Analytics outranks Costs for a costs word, and Gallery, Map and Story have no synonyms at all
type: ISSUE
priority: medium
complexity: low
area: search
found: "2026-09-08T15:48:08Z"
started: "2026-09-08T15:48:26Z"
session: 6c81e17b-6acf-4c0f-86ef-49124c9b2458
claimed: "2026-09-08T15:48:26Z"
---

# B974 — Live search: Analytics outranks Costs for a costs word, and Gallery, Map and Story have no synonyms at all

## Why

Probed against fernscout.ch (the deployed index, MiniSearch loaded with the
shipped options), four faults in what B903 landed:

1. **"Preis" ranks four Analytics rows above the costs page.** Both
   `search.analyticsTerms` and `search.costsTerms` carry the money words, and
   they were written that way before Costs had a row of its own (B903 gave it
   one). Analytics is now the hub *above* the answer, and it wins.
2. **Gallery, Map and Story have no `synonymsKey` at all** — they are the
   three oldest rows (B823) and were never given one. "Bilder" and "Fotos",
   which is what a German reader calls a gallery, return one documentation
   page and nothing else; "Route" and "wo waren wir" return nothing.
3. **"Hilfe" ranks Hosting, Contributing and API above the three guides.**
   Every docs row carries the same `search.docsTerms`, so the tie is broken by
   length — and the guides, being the ones with a body indexed, lose it. The
   guides are the pages written for a person asking for help; the technical
   four are for somebody deciding whether to self-host.
4. **A day is findable only in the language it was written in.** "Zion" finds
   the day; "Sonnenaufgang" finds nothing on a journal written in English.
   That is inherent to token matching and is what B904's agent answers — worth
   writing down here so the next person does not read it as a bug in this
   ticket.

## Work

- Split the vocabularies: `search.analyticsTerms` keeps what the *hub* is
  (statistics, numbers, overview) and gives up the money words to
  `search.costsTerms`, which now has the page they belong to.
- Give Gallery, Map and Story their own synonym rows, in all three languages.
- `search.docsTerms` for the guides, a second key for the technical pages, so
  "help" reaches what was written for a person.
- Not doing: (4). It is the agent's job, and B904 shipped it.

## Acceptance

- Against the live index: "Preis" ranks the costs page first, "Bilder" and
  "Fotos" reach the gallery, "Route" reaches the map, "Hilfe" ranks a guide
  first.
- `npm run verify` green.
