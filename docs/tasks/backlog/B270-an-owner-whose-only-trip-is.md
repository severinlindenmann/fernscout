---
id: B270
title: An owner whose only trip is public but unlisted sees four zeroes and no empty state
type: ISSUE
priority: low
complexity: low
area: trips, access
found: "2026-09-04T11:52:43Z"
---

# B270 — An owner whose only trip is public but unlisted sees four zeroes and no empty state

## Why

Found while building B264, predates it, and unchanged by it.

`listableTrips` filters a `public, listed: false` trip out for **everyone**,
the owner included: the check short-circuits on `visibility === "public"`
before it ever reaches the owner match. So an owner whose journal contains
exactly one such trip and nothing else gets the trips page with no cards, four
zero tiles, and no empty state either — B264's non-owner message is
deliberately not shown to an owner, and the owner's own empty state asks
`all.length === 0`, which is false.

It is a narrow corner, which is why B264 left the owner branch alone rather
than widening its scope. It is also the one state where somebody is looking at
their own journal and being told nothing about their own trip.

Worth deciding rather than fixing blind: whether `listed: false` should hide a
trip from its owner at all. `listed:` is described in AGENTS.md as being about
advertisement — the sitemap, the feed, the switcher — and the owner's own trip
list is arguably not advertisement. If that is right, the fix is in
`listableTrips` and this page needs no change; if it is wrong, the fix is the
owner's empty state.

## Acceptance

An owner whose only trip is `public, listed: false` sees either the trip or a
sentence about why they do not, and the reasoning for which is written down.
Whatever changes, a stranger's view of that journal is unchanged — asserted by
a test.
