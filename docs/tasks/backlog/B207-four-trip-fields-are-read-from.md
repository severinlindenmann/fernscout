---
id: B207
title: Four trip fields are read from trip.md and nothing can write them
type: ISSUE
priority: low
complexity: low
area: trips, api
found: "2026-09-04T06:14:14Z"
---

# B207 — Four trip fields are read from trip.md and nothing can write them

## Why

B178 asked for a check of the rest of the parsed frontmatter once
`costsVisibility` had been closed, on the grounds that two such gaps had
turned up in one day and a third would not be a surprise. There are four.

`KNOWN_TRIP_FIELDS` in `lib/trips.ts` is the whole vocabulary of a `trip.md`.
`createTrip` (`lib/tripWrite.ts`) now writes `id`, `title`, `tagline`,
`start`, `end`, `status`, `accent`, `visibility`, `listed`, `costsVisibility`
and `test`. It has never written, and neither door has ever accepted:

- **`people`** — the significant one. It is who took the trip, and per
  AGENTS.md everyone listed *may write to the whole trip* and *may hold an
  agent token scoped to it*, as well as being the byline. An owner working
  through an agent — the only way this product is written — cannot put anybody
  on a trip. The buddy-link flow (B33) adds rows that `peopleOf()` merges, so
  there is a second route to write *access*; there is no route at all to the
  credit, which is rendered from the file alone.
- **`cover`** — the trip's cover image.
- **`rates`** — this trip's frozen local→base currency table. Without it every
  foreign-currency cost in the trip is read in the base currency.
- **`translations`** — the trip's title in the journal's other locales.

Each is read, typed and rendered; none can be produced by any means the
product offers. `people` is the one with a real consequence and the other
three are the same shape.

## Work

- Decide each separately rather than adding four properties at once. `people`
  is the one worth arguing about: it grants write access, so accepting it on a
  create is handing an agent the ability to widen who may write, and it may
  belong on an owner-only update path rather than on create.
- Whichever are accepted go on **both** doors — REST body and MCP
  `inputSchema` — with the round-trip asserted, as B178 did.
- `rates` and `translations` are maps rather than scalars, so they need a
  shape check before they reach the frontmatter writer, not just a quote.

Not doing: a general trip-update endpoint. That is a bigger question than this
capture, which is only about the fields the reader already understands.

## Acceptance

- For each of the four, the file records either a writer with a round-trip
  test, or a sentence saying why the field stays file-only and where a person
  is told to hand-edit it.
- Nothing in `KNOWN_TRIP_FIELDS` is left undecided.
