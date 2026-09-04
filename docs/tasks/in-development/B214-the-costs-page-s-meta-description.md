---
id: B214
title: The costs page's meta description is present-tense on a trip that has not started
type: ISSUE
priority: low
complexity: low
area: i18n, costs, metadata
found: "2026-09-04T06:32:41Z"
started: "2026-09-04T09:30:24Z"
session: 7d30451d-0304-4631-8484-d96036fb11b4
claimed: "2026-09-04T09:30:24Z"
---

# B214 — The costs page's meta description is present-tense on a trip that has not started

## Why

Found while fixing B139, which gave `app/[user]/(trip)/costs/page.tsx` its
metadata in the reader's language. The `<meta name="description">` and the
sharing blurb are now `cost.subtitle`:

> Everything we spend, in CHF — from the visas and jabs before we left to
> today's coffee.

The page underneath does not say that on a trip that has not started. It picks
between `cost.subtitle` and `cost.subtitlePlanned` from `summary.hasBegun`
(`app/[user]/(trip)/costs/CostsPageContent.tsx:43`), which is B19's fix: a
costs page for a trip fourteen months away must not report spending as though
it were under way. `generateMetadata` makes no such choice, so on a journal
whose current trip is upcoming the description claims a trip in progress while
the standfirst one line below it says the opposite.

This is the same shape as B118 — `generateMetadata` deciding independently of
what the page will render — narrowed to the one field B139 deliberately did
not touch. B139 fixed the *language*; the tense was named as out of scope
there and captured here rather than absorbed.

The cost is small and presentational: a link preview and a search snippet, on
the window before a trip starts. Nothing on the page itself is wrong.

## Work

Decide the tense in `generateMetadata` the way `CostsPageContent` decides it,
from the same flag rather than from a second reading of `trip.status`. The
obstacle is cost: `getCostSummary` is not cached (`lib/costs.ts`), so calling
it in metadata doubles the work for one string. `hasBegun(trip)` from
`lib/tripTime.ts` is the cheap half of the same question and is likely enough —
it differs only for a trip marked `upcoming` that already has a day written.

Whichever is chosen, the title is unaffected: `cost.title` has one tense.

Not doing: the `<h1>`, which is already right.

## Acceptance

- On a journal whose current trip has not begun, `/<user>/costs` returns a
  description matching `cost.subtitlePlanned`, and it matches the standfirst
  the page renders.
- On a trip under way, both stay `cost.subtitle`.
- A test asserts the pairing, as `test/map-tense.test.tsx` does for the map.
