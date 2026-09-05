---
id: B250
title: The trip-scoped costs page describes an upcoming trip in the past tense, in English only
type: ISSUE
priority: low
complexity: low
area: i18n, costs, metadata
found: "2026-09-04T09:40:06Z"
started: "2026-09-05T15:04:59Z"
session: e5747799-fd3e-4d40-a335-82fa4e24333e
claimed: "2026-09-05T15:04:59Z"
---

# B250 — The trip-scoped costs page describes an upcoming trip in the past tense, in English only

## Why

**Update, 2026-09-05: the code fix already landed.** Commit `33bf92f` ("B214,
B382: the trip-scoped costs page's description gets its own tense and drops
the slug") rewrote `generateMetadata` in
`app/[user]/trips/[trip]/costs/page.tsx` to pick between the new
`cost.tripDescription` / `cost.tripDescriptionPlanned` keys via
`hasBegun(trip, getDays(trip.ref))`, added both keys to `lib/i18n.ts` and all
three dictionaries, and left `test/trip-costs-description.test.ts` behind —
but that test only checked English and only checked the metadata in
isolation; it never rendered `CostsPageContent`'s own standfirst to confirm
the two agree, which is the actual acceptance criterion below and the reason
this ticket stayed open. What follows is the original Why, kept because the
literal it names is what the test above still guards against a regression to.

`app/[user]/trips/[trip]/costs/page.tsx:42` **used to build** its
`<meta name="description">` from an English literal:

```ts
description: `What ${trip.title} actually cost, itemised in ${trip.username}'s currency.`,
```

Two things were wrong with it, and they were found together while doing B214.

**The tense.** This is the route where a *planned* costs page actually
renders. `getCurrentTrip` returns a trip declaring `status: current` or the
most recent `past` one, so `/<user>/costs` is never an `upcoming` trip;
`/<user>/trips/<trip>/costs` is the only address an upcoming trip's costs have.
There `CostsPageContent` renders `cost.subtitlePlanned` — "this trip has not
started yet" — under a description saying what the trip *actually cost*. That
is B214's symptom, on the one route where it can be observed.

**The language.** B139 gave this route's `title` the reader's language and left
the description an English sentence, so a German journal shares a German title
with an English blurb. It is also the last hand-written paraphrase of a page's
own words left in a costs route: the journal-scoped one next door uses
`cost.subtitle` / `cost.subtitlePlanned`, which is why its tense could be fixed
by picking between two strings that already exist.

The cost is a link preview and a search snippet, on a trip somebody is
planning — which is exactly when they are most likely to send the link to the
people coming with them.

Not absorbed into B214: that ticket names the journal-scoped route, its
acceptance is about `/<user>/costs`, and its fix is a choice between two
existing translated strings. This one needs a decision about what a trip's
costs page should say about *that named trip* in three languages, which is new
copy rather than a conditional.

## Work

- ~~Decide what the description should say.~~ Already decided in `33bf92f`:
  new keys `cost.tripDescription` / `cost.tripDescriptionPlanned`, taking the
  trip's title the way `meta.sectionOfTrip` already does — not the existing,
  nameless `cost.subtitle` / `cost.subtitlePlanned`.
- ~~Pick the tense from the same flag the page uses~~ — done:
  `hasBegun(trip, getDays(trip.ref))`.
- The remaining work, done in this session: extend
  `test/trip-costs-description.test.tsx` (renamed from `.test.ts` — it now
  renders JSX) with a locale-parametrised (`en`/`de`/`hu`) pairing test that
  renders `CostsPageContent`'s own standfirst via `getCostSummary` and asserts
  it agrees with `generateMetadata`'s tense, the same shape as
  `test/costs-tense.test.tsx` for the journal-scoped route. No dictionary
  files were touched — the three locales' `cost.tripDescription` /
  `cost.tripDescriptionPlanned` strings already existed.

Not doing: the `title`, which B139 already resolved.

## Acceptance

- `/<user>/trips/<upcoming-trip>/costs` returns a description that does not
  claim the trip has happened, and it agrees with the standfirst the page
  renders. **Met** by `33bf92f`; the German/Hungarian pairing case is new.
- On a German or Hungarian journal the description is in that language.
  **Met** — `content/locales/de.json` and `hu.json` both carry
  `cost.tripDescription(Planned)`.
- A test asserts the pairing, as `test/costs-tense.test.tsx` does for the
  journal-scoped route. **Met** — see `describe.each(["en", "de", "hu"])("a
  trip-scoped costs page in %s", ...)` in `test/trip-costs-description.test.tsx`.
  Verified it fails against the old English literal: reverted `page.tsx` to
  the pre-`33bf92f` string locally, ran the file (4 of 7 tests failed), then
  restored it.
