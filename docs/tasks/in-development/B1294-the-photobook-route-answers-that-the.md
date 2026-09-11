---
id: B1294
title: The photobook route answers that the trip was taken down or renamed when the trip is still there
type: ISSUE
priority: low
complexity: low
area: photobook
found: "2026-09-10T10:59:33Z"
started: "2026-09-11T04:23:09Z"
session: 96a5b964-fad1-4616-9124-a01eabbd8a46
claimed: "2026-09-11T04:23:09Z"
---

# B1294 — The photobook route answers that the trip was taken down or renamed when the trip is still there
## Why

`GET /example/trips/usa-2026/photobook` renders:

> **That trip isn't here any more**
> It was taken down or renamed. The other trips are all still where they were.

The trip is there. `/example/trips/usa-2026` answers 307 to `/example`, which is
the canonicalisation for the *current* trip, and every other page of it works.
What is missing is the photobook entry (`photobookEntryFor(trip)` returns null →
`notFound()`), not the trip.

So the page states, confidently and specifically, something false about the
reader's own content — and it is the alarming version of false: *your trip was
taken down*. An owner meeting this on their phone has been told their journey is
gone.

Every trip on the demo journal does this, so there is currently no working
photobook page anywhere on the live instance to compare against (noted in B1279
as well).

## Work

- A 404 whose cause is "this page does not apply to this trip" should not use the
  copy for "this trip does not exist". Either say what is actually missing, or
  do not route to a not-found at all.
- Worth checking first *why* `photobookEntryFor` returns null for every trip
  here — that may be the real bug, and this ticket only the way it surfaces.

## Acceptance

- Asking for a photobook of a trip that exists never says the trip was taken down
  or renamed.
