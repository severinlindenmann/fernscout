---
id: B587
title: A closed trip cannot be advertised as a locked card on the trips overview
type: FEATURE
priority: medium
complexity: medium
area: trips, access
found: "2026-09-06T14:17:50Z"
merged: "2026-09-06T14:32:39Z"
---

# B587 — A closed trip cannot be advertised as a locked card on the trips overview

## Why

A `guest` or `private` trip is invisible on `/<user>/trips` to everybody the
gate would refuse — `listableTrips` filters it out, and B264 folds the result
into an empty page. That is the right default and the wrong only option: an
owner who wants the *existence* of a trip known ("Algarve 2026, June, ask me
for a link") has no way to say so. The only lever today is `visibility:
public`, which hands over every day, photograph and cost as well.

`listed:` cannot carry it. It is defined as narrowing-only and `parseListed`
refuses `listed: true` on a closed trip (B51), because `isIndexable`,
`listableTrips` and `resolveViewer` each read it paired with `visibility ===
"public"` — widening it would be a leak the first time one of them read the
field alone.

## Work

A third axis, `teaser: true` in `trip.md`, honoured only on a `guest` or
`private` trip: the trips overview shows a locked card — title, dates and a
"closed" mark, linking to the trip's own sign-in gate. Nothing else reads it:
no sitemap, no feed, no switcher, no stats, no cover, no tagline, no route on
the lifetime map.

Write path too, since there is no editing interface: `teaser` on trip create
and update, read back on the trip `GET`, documented in `/openapi.json` and
`/agent.md` with the refusal on a public trip.

Not doing: a per-trip message on the card, and any change to what the gate
page itself says (B117 stands — the gate still does not name the trip).

## Acceptance

With `teaser: true` on a `private` trip: an anonymous reader sees a locked
card with the title and dates and no counts, and `curl /sitemap.xml` does not
mention it. On a `public, listed: false` trip the key is refused and logged.
