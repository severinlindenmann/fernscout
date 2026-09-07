---
id: B622
title: An agent cannot rename a trip or move its dates, though the owner's own page now can
type: FEATURE
priority: medium
complexity: low
area: api, trips
found: "2026-09-06T17:05:57Z"
started: "2026-09-06T17:50:49Z"
merged: "2026-09-06T18:02:20Z"
completed: "2026-09-07T13:12:32Z"
---

# B622 — An agent cannot rename a trip or move its dates, though the owner's own page now can

## Why

B621 built `patchTripDetails` in `lib/api/tripDetails.ts` and put a cookie-only
door in front of it at `PATCH /api/trip`, because the ask was a pencil on the
owner's own page. The agent-facing side of the same four fields is still
missing: `PATCH /api/v1/<user>/trips/<trip>` answers `405` and now says so in
words, pointing the caller at the owner's page.

That is honest and it is a hole. Every other field of a trip has an agent
door — `visibility`, `rates`, `people`, `travellers`, `tracks` — and "the
agent is the editor" is the whole shape of this software. An owner who tells
their agent "the trip is called Algarve, not Alagrve" should not be answered
with "open your own page and use the pencil".

## Work

The writer already exists and is already the one place the rules live, so this
is a route and a contract:

- `PATCH /api/v1/<user>/trips/<trip>` — owner only, the same split
  `.../visibility` uses, taking `title`, `tagline`, `start` and `end` into
  `patchTripDetails`. Its current `405` handler is what to replace.
- The `mixed_change` refusal `/api/trip` makes has no equivalent here:
  visibility is a route of its own on this side, so a body naming it is
  simply an unknown field.
- `lib/api/openapi.ts` and `/agent.md`: a new verb, its four fields, at least
  one refusal, and the `GET` that reads them back.

## Acceptance

- An agent token renames a trip and moves its dates, and `GET
  /api/v1/<user>/trips/<trip>` reads the new values back.
- A trip-scoped token is refused — it writes days into its trip and does not
  decide what the journey is called.
- The refusal in the old `405` handler is gone rather than left pointing at a
  page for something this now does.
