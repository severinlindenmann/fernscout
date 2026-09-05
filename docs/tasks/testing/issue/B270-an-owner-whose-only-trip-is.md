---
id: B270
title: An owner whose only trip is public but unlisted sees four zeroes and no empty state
type: ISSUE
priority: low
complexity: low
area: trips, access
found: "2026-09-04T11:52:43Z"
started: "2026-09-04T15:49:33Z"
merged: "2026-09-04T16:00:10Z"
session: 62683d95-33a6-4db0-a254-7a8fcbcf014e
claimed: "2026-09-05T07:38:37Z"
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

## Decision

`listed: false` hides the trip from the owner too, and that stays as-is —
`listableTrips` is not touched. This was not a judgment call so much as a
discovery: the codebase had already decided and tested it. `test/access-gate
.test.ts`'s `EXPECTED` table has an explicit `owner` row for `quiet-2026`
(`public`, `listed: false`) asserting `switcher: false`, and two tests derived
from that table —
"the only trip the gate opens without the switcher listing it is an unlisted
public one" and the panel's equivalent — assert this holds for *every*
viewer in the table, owner included, with no carve-out. Widening
`listableTrips` for the owner would have meant reversing an existing,
deliberately-worded, already-green test rather than fixing an oversight.

The fix is therefore the owner's empty state: `app/[user]/trips/page.tsx` now
distinguishes `trips.length === 0` into two owner cases — `all.length === 0`
(genuinely empty, unchanged: the agent-handover prompt) and `all.length > 0`
(a real trip, filtered out from under its own owner) — the latter sets
`empty = { owner: true, siteUrl, filtered: true }`. `TripsIndexContent`'s
`EmptyState` renders a distinct sentence for it ("Nothing listed here" /
`trips.emptyOwnerFilteredBody`, naming `listed: false` directly, since this is
the owner reading about their own file) and skips the agent-handover button,
which would be wrong here — there is no first day to write, the trip already
exists.

A stranger's branch (`owner: false`) is untouched: `test/unlisted-owner-trip
.test.tsx` asserts a stranger looking at the same fixture still gets the
ordinary `{ owner: false, signedIn: false, ownerName }` shape, byte-identical
to a genuinely empty journal per B264.

New tests: `test/unlisted-owner-trip.test.tsx` (page.tsx-level, both the
owner's and a stranger's props against a real `public, listed: false` trip.md
fixture) and two cases added to `test/empty-journal.test.tsx` (the
component-level rendering of the `filtered: true` state).
