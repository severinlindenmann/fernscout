---
id: B904
title: Search matches words, not meaning — a person who asks for a topic in their own words gets nothing
type: FEATURE
priority: medium
complexity: high
area: search
found: "2026-09-08T00:00:00Z"
started: "2026-09-08T04:54:50Z"
session: 6c81e17b-6acf-4c0f-86ef-49124c9b2458
claimed: "2026-09-08T04:54:50Z"
---

# B904 — Search matches words, not meaning — a person who asks for a topic in their own words gets nothing

## Why

MiniSearch matches tokens. It is fast, it runs in the browser, it costs
nothing, and it cannot answer "the day we got lost near the border" or "wo
haben wir das teuerste Hotel gehabt" — nothing in either sentence is a token
in the index. The reader is left guessing which word the writer used, which
is the one thing a person searching a journal is worst at: they remember what
happened, not what it was called.

The index already holds a compact description of everything this reader may
see (B890, B903): every day with its title, place, date and trip; every trip;
every page; the documentation. That is a catalogue a model can read in one
request and match by meaning — and it is already permission-filtered, which is
the part that must not be rebuilt.

## Work

- `POST /api/helper/<user>/search`, beside the other helper routes and with
  their gate order: owner (cookie only, bearer refused by construction),
  `isEnabled("helper")`, rate limit, then the model. **Free**, for the same
  reason `ask` is: a front door that meters is a front door nobody knocks on.
- `lib/search.ts` exports the catalogue — the same rows the reader's index is
  built from, trimmed to what a model needs (kind, title, place, date, trip)
  and capped, with the cap logged rather than silent.
- **The model returns ids, never URLs.** Anything it names that is not in the
  catalogue it was given is dropped. A model that invents a plausible URL
  would otherwise be inventing a page, and this codebase's one rule is that an
  agent does not invent what happened.
- `components/SearchBox.tsx`: a button, pressed on purpose — never a search
  that quietly costs a model call — showing the hits with the one line of
  reasoning each.
- Not doing: embeddings, a vector store, a background index, or replacing
  MiniSearch. Typing still searches locally and instantly.

## Acceptance

- A sentence with none of a day's words in it finds that day on the demo
  journal.
- `test/helper-search.test.ts`: an id the model returns that is not in the
  catalogue is dropped; a journal that is not yours answers 404; the route
  refuses a bearer token.
- `npm run verify` green.
