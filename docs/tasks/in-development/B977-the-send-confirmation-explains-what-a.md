---
id: B977
title: The send confirmation explains what a credit is worth, on a day page nobody asked about pricing on
type: ISSUE
priority: medium
complexity: low
area: day page, owner tools
found: "2026-09-08T16:10:21Z"
started: "2026-09-08T20:21:47Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T20:21:47Z"
superseded: "B978"
---

# B977 — The send confirmation explains what a credit is worth, on a day page nobody asked about pricing on

## Why

Duplicate capture. B977 and B978 have the identical title and were found six
seconds apart (`2026-09-08T16:10:21Z` vs `16:10:26Z`) — the same finding
captured twice: the send confirmation in `components/DayNotify.tsx` carried a
second paragraph explaining what a credit is worth in real money
(`credits.worth`, added by B806), on a day page where nobody asked about
pricing.

## Work

Nothing to build here. B978 already did the fix and is merged into `main` at
commit `b80fc5a8` ("B978, B979: no pricing copy on a day; the ask leads to
the room, on this day"), which this branch has as an ancestor. Confirmed by
reading `components/DayNotify.tsx` as it stands today: no `creditWorth`
import, no `credits.worth` string, and the confirm panel now shows only the
per-channel cost list and the "That is {needed} in all, leaving {rest}."
total — exactly what B978's Acceptance asked for. `creditWorth()` and the
`credits.worth` locale string are still exported/used, from
`components/AgentWizard.tsx` (`/agent` wizard consent panels), which is the
`/<user>/me`-adjacent surface B978 said the explanation belongs on.

## Acceptance

Not applicable — no code change. Filing this as superseded by B978 rather
than building anything against it.
