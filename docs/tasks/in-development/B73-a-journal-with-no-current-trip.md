---
id: B73
title: A journal with no current trip answers 404 on three of the four pages its own nav offers
type: ISSUE
priority: high
complexity: low
area: routing, nav, trips
found: "2026-09-01"
started: "2026-09-01"
---

# B73 — A journal with no current trip answers 404 on three of the four pages its own nav offers

## Why

Found on 2026-09-01, on a newly created journal with no trips in it yet. Every
icon in the header is a link, and three of them lead to:

> **Diese Seite gibt es nicht**
> Der Link ist vermutlich älter als die Seite, auf die er zeigt …

The 404 copy is written for a stale bookmark. Nothing here is stale — the link
was rendered by this page, for this journal, one moment ago.

`SiteNav` (`components/SiteNav.tsx:11–16`, `:36`) has four trip-scoped links,
and when no trip is in context it points all four at the journal's own base:
`/<user>`, `/<user>/gallery`, `/<user>/map`, `/<user>/costs`. All four resolve
their trip the same way, and there is no trip to resolve.

The first of the four was fixed and the other three were not. `app/[user]/(trip)/page.tsx:26`:

```ts
const tripId = currentTripRef(user);
if (!tripId) redirect(`/${user}/trips`);
```

with a docblock above it (`:17–24`) that says exactly why — *"a journal created
through the API was born broken, and its owner's first act was to look at a
page that said it did not exist"*. Its three siblings still read:

- `app/[user]/(trip)/gallery/page.tsx:37–38` — `if (!tripId) notFound();`
- `app/[user]/(trip)/map/page.tsx:41–42` — the same
- `app/[user]/(trip)/costs/page.tsx:36–37` — the same

Having no current trip is not an error condition. It is the state every journal
starts in, and the state any journal returns to between journeys —
`getCurrentTrip` (`lib/trips.ts:449–451`) also answers `undefined` when the
only trip is `upcoming`, which is how the journal in **B72** reached this even
after a trip had been created and filled with days.

The cost lands on exactly the person least able to read past it: somebody
opening their own journal for the first time, clicking the things in the menu
bar, and being told by three of them that the page does not exist.

## Work

Give the three siblings the treatment `page.tsx` already has: redirect to
`/<user>/trips` rather than `notFound()`. The trip list is the honest
destination — it is where the journal's content actually is, and where **B76**
would put the "you have not started a trip yet" state.

The alternative — hiding the four nav links when no trip is in context — is
worse, and should not be taken: `SiteNav` is a client component with no server
knowledge of whether the journal has a current trip, and a nav whose items come
and go is harder to trust than one whose items always land somewhere.

Related: **B72** (why a journal with a trip in it still had no current trip),
**B76** (what the trip list should say when it is empty). Fixing this one alone
still leaves the reader on a page of four zeroes, but at least not on a 404.

## Acceptance

- On a journal with no trips at all, every link in the header nav lands on a
  page that renders. None answers 404.
- The same holds when the journal's only trip is `upcoming`.
- A test that builds a journal with zero trips and asserts a redirect from
  `/<user>/gallery`, `/<user>/map` and `/<user>/costs`.
