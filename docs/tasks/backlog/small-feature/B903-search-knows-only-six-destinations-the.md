---
id: B903
title: Search knows only six destinations — the sign-in door, the helper, the inbox, costs, weather and the imprint are unfindable
type: FEATURE
priority: medium
complexity: medium
area: search
found: "2026-09-08T00:00:00Z"
---

# B903 — Search knows only six destinations — the sign-in door, the helper, the inbox, costs, weather and the imprint are unfindable

## Why

B890 gave search the trips, the documentation and three journal-scoped rows.
The list is still shorter than the site:

- **The sign-in door.** `/<user>/me` is indexed for a reader who is already
  signed in, which is exactly backwards for the word people type: somebody
  searching *Anmelden* is by definition not signed in, and the reader index is
  the only one that carries the row. `SiteNav` draws that same door for
  everybody (`strangerDoor`), labelled "Sign in" when there is no session.
- **Costs and weather have their own pages** — `/costs`, `/weather` — and
  neither is a row. They are reachable through the Analytics hub, which is
  only indexed when *some* analysis has data, so on a journal that has costs
  and no Analytics tab (`analyticsAvailable` false) *Preis* still finds
  nothing.
- **The helper is the whole writing surface and is in no index.** `/agent/
  <user>` and its inbox are where an owner writes a day, hands over photographs
  and reads a statement.
- **`/<user>/me/analytics`** (who is reading), **`/legal`** (the imprint), and
  the **`/docs` hub** itself are all pages this site renders and search cannot
  reach.
- **`/photobook`** is a trip-scoped page for an owner with the capability on.

Each is gated differently, and the gates are the load-bearing part: a row that
leads to a 404 is the bug `SiteNav`'s own comments describe at length, and a
row that names an owner-only page to a stranger is worse.

## Work

- `lib/navDestinations.ts`: extend `JOURNAL_DESTINATIONS`, and add the
  trip-scoped pages that are not in the header nav (costs, weather,
  photobook). The list stays here; the availability question stays in
  `lib/search.ts`, which is the only side that may ask a server-only one.
- `/me` becomes a public row whose **label depends on the index**: "Sign in"
  in the anonymous one, "Your access" in a reader's — the same choice
  `SiteNav` makes, and it costs nothing because the two indexes are built
  separately anyway. Gated on `isEnabled("auth")`.
- Availability per row: `costs`/`weather` on the capability *and* the trip
  having data; `photobook` on `photobookEntryFor`; the helper and its inbox on
  `isEnabled("helper")` and the owner; visitors on `isEnabled("analytics")`;
  `/legal` on `hasLegal()`.
- Synonyms for each, in all three languages.
- Not doing: `/search` itself, the postcard and payment pages (addressed by
  id, so there is nothing to index), or the branding workbenches (English
  only, deliberately unindexed — `lib/docs.ts` says so).

## Acceptance

- `test/search.test.ts` / `test/search-reader.test.ts`: the anonymous index
  carries `/me` labelled "Sign in" and the reader's carries "Your access"; the
  helper, inbox and visitors rows appear for the owner and nobody else; a
  journal with `costs` off has no costs row.
- On the demo journal, searching *Preis*, *Anmelden*, *Fotobuch* and
  *Impressum* each land on the right page.
- `npm run verify` green.
