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

`app/[user]/trips/[trip]/costs/page.tsx:42` builds its `<meta name="description">`
from an English literal:

```ts
description: `What ${trip.title} actually cost, itemised in ${trip.username}'s currency.`,
```

Two things are wrong with it, and they were found together while doing B214.

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

- Decide what the description should say. `cost.subtitle` / `cost.subtitlePlanned`
  are about "the trip" with no name in them, so either they are good enough here
  too, or this route wants a `meta.` string that takes the trip's title the way
  `meta.sectionOfTrip` already does for the heading.
- Pick the tense from the same flag the page uses, as B214 did next door:
  `hasBegun(trip, getDays(trip.ref))`, not `trip.status` read a second time.
- Whatever is chosen, the trip's own title is the author's and is never
  translated — see the note already in that `generateMetadata`.

Not doing: the `title`, which B139 already resolved.

## Acceptance

- `/<user>/trips/<upcoming-trip>/costs` returns a description that does not
  claim the trip has happened, and it agrees with the standfirst the page
  renders.
- On a German or Hungarian journal the description is in that language.
- A test asserts the pairing, as `test/costs-tense.test.tsx` does for the
  journal-scoped route.
