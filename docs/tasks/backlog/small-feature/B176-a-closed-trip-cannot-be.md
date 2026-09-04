---
id: B176
title: A closed trip cannot be advertised as existing without being made readable
type: FEATURE
priority: low
complexity: medium
area: trips, access
found: "2026-09-03"
---

# B176 — A closed trip cannot be advertised as existing without being made readable

## Why

There are two questions about a trip and the software can only answer one of
them independently. `visibility:` decides who may read it; `listed:` decides
whether it is advertised — but only downwards. Since B51 the key is read and
narrows, so a `public` trip can be held out of the sitemap, the feed and the
switcher. The other direction does not exist: a `guest` or `private` trip is
never advertised, and `listed: true` on one is refused.

There is a real thing that refusal makes impossible. A journal whose switcher
shows "Japan 2027" with a lock on it tells a reader the trip is there and that
there is somebody to ask; a journal that shows nothing tells them the trip does
not exist. The second is what a family member sees today, and asking for access
to something you cannot see is the same dead end B41 closed for the panel on
`/<user>/me`.

It was not built with B51 because it is not a parsing bug — it is a change to
what `listed` *means* at each of its three consumers. `isIndexable`
(`lib/access.ts:56`), `listableTrips` (`lib/tripGate.ts`) and `resolveViewer`
(`lib/viewer.ts`) each pair `trip.listed` with `visibility === "public"`, and
each would need its own answer to "advertised, but shut". A sitemap entry for a
page that returns a gate is not the same decision as a row in a switcher.

## Work

- Decide what "advertised but shut" means per surface, and write it down before
  writing code. A first guess: the switcher and `/<user>/me` show the trip with
  a lock and a way to ask; the sitemap, the feed and the search index do not.
  A crawler being told a URL exists is not the same favour as a person being
  told their aunt has a trip they could ask about.
- Only then decide the spelling. It may not be `listed: true` on a closed trip
  at all — a separate `announce:` would keep `listed` monotone, and B51's
  reasoning for making the parser the choke point still applies.
- Whatever it is, the trip's title and dates are the *most* that may leak. The
  gate's `lockedMetadata` is the standard: title only, `noindex`, nothing drawn
  from a day's prose.

Not doing: touching `mayReadTrip`. This is entirely about what a reader is
*told exists*, and must not move a single trip from refused to readable.

## Acceptance

- A `guest` trip the owner marks as announced appears, locked, in the switcher
  and on `/<user>/me` for somebody who cannot read it — and the gate still
  refuses them.
- Nothing about the trip beyond its title and dates reaches an unauthorised
  reader, asserted by a test that reads the RSC payload the way
  `test/access-gate.test.ts` does.
- The table in `test/access-gate.test.ts` grows a column for it, so the panel,
  the switcher, the digest and the gate keep naming one set of trips between
  them.
