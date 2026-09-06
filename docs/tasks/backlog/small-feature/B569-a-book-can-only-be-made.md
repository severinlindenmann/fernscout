---
id: B569
title: A book can only be made of the trip marked current, not of a finished one
type: FEATURE
priority: high
complexity: medium
area: photobook, composer
found: "2026-09-06T11:19:27Z"
---

# B569 — A book can only be made of the trip marked current, not of a finished one

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`app/[user]/(trip)/photobook/page.tsx:23` builds the composer from
`currentTripOrRedirect(user)`, and `getCurrentTrip` (`lib/trips.ts:769`) returns
the trip whose frontmatter says `status: current`, falling back to any `past`
one. The page destructures `searchParams` and never uses it to choose a trip.

So the composer makes a book of whichever trip is currently marked `current`,
and there is no way to ask for another. On the demo journal that is `usa-2026`;
`parks-2025`, `alps-2024` and `asia-2023` are all `past` and unreachable, and
the trip switcher in the header does not change what the composer builds.

That is the wrong way round for this feature. **A photobook is what you make
when a journey is finished.** The trip most likely to deserve one is precisely
the one this page cannot open — and the person who asked for these changes was
looking at a book of `parks-2025`, a past trip, which the composer as written
cannot produce.

Found while verifying B564: switching to an eighteen-day trip to watch the page
count fall was impossible, so the acceptance could only be checked by unit test.
That is a second cost — the longest trips are the ones that exercise volumes,
`expandToMinimum` and the binder maximum, and none of them can be reached from
the page by hand.

## Work

Let the composer take a trip. The `(trip)` route group and `mayReadTrip` are
already the shape for it, and the header's switcher is already the vocabulary a
reader knows.

Whatever the mechanism, the gate must stay: `mayReadTrip` decides, and a trip
somebody cannot read must not become a book. `photobookEntryFor` is where the
owner-only question is asked, and it must keep asking it — the page deliberately
does not ask `isOwner` itself, so `test/draft-audience.test.ts` stays quiet.

Consider where somebody starts. "Make a book of this trip" from a trip's own
page is a more natural door than a composer that guesses.

## Acceptance

- A book can be made of a finished trip.
- A trip the reader may not read cannot be opened in the composer, by any route.
- Switching trips and returning to the composer builds the trip that was chosen.
