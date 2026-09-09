---
id: B906
title: Nothing can find the day with the photograph of Anna in it
type: FEATURE
priority: high
complexity: medium
area: api, search
found: "2026-09-08T04:57:39Z"
started: "2026-09-09T04:58:13Z"
session: eef381a2-5a19-477a-a5ce-5f4f2d3dacab
claimed: "2026-09-09T04:58:13Z"
---

# B906 — Nothing can find the day with the photograph of Anna in it

## Why

Nothing in the API can answer *"the day with the photo of Anna in it"* — which
is the exact sentence a tester typed at the helper in B817, and the one that
routed to the screen that **creates** a day.

Every day-finding tool resolves by date or by slug. The sentence people
actually say names a **thing**: a person, a place, a meal, a mountain. A person
remembers what happened, not which Tuesday it was.

This is the single most likely source of the next misroute, and it is a gap in
the API rather than in the helper: there is no route to call, so no tool can be
written and the model's nearest neighbour wins by default.

The journal already builds a search index — `/<user>/search-index.json`, which
`documentCount` reports on — so the data exists and only the door is missing.

Found by mapping every operation to a chat shape, 2026-09-08.

## Work

A search route over a journal's days: a query, and matches with enough context
to choose between them — trip, date, title, and why it matched.

It must respect the reader: a search as an owner sees drafts and closed trips;
the same route as a guest sees only what that guest may read. `visible()` in
`lib/entries.ts` and `readFor` in `lib/tripGate.ts` are the existing answers to
that, and a search that forgets them is a way to enumerate a private trip.

Then a `find_day` read tool over it, which is what stops "the day with the
photo of Anna" landing on a writing screen.

## Acceptance

A sentence naming a thing rather than a date finds the day, and finds nothing
the asker may not read.
