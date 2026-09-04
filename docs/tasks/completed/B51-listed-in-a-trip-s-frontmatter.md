---
id: B51
title: A trip's listed frontmatter key is documented and never read
type: ISSUE
priority: medium
complexity: low
area: trips, content
found: "2026-09-01"
started: "2026-09-03T19:24:38Z"
merged: "2026-09-03T19:41:21Z"
completed: "2026-09-04T05:20:41Z"
---

# B51 — A trip's `listed` frontmatter key is documented and never read

## Why

`AGENTS.md` says `listed:` is "the separate question of whether it is
advertised at all", and `add-a-trip` tells an agent it is a field to set. It is
not read anywhere.

`parseVisibility` (`lib/trips.ts:174`) returns *both* `visibility` and `listed`
from the single `visibility:` value, and `parseTrip` (`lib/trips.ts:306`)
spreads that result and never looks at `data.listed`. So:

- `visibility: public` + `listed: false` is a **listed** trip. The key is
  silently discarded.
- The only spelling that produces an unlisted public trip is the legacy
  `visibility: unlisted`, which the same documentation describes as an older
  word kept for compatibility.
- `visibility: guest` and `visibility: private` are always `listed: false`, so
  `listed: true` cannot be expressed at all.

`listed` is not decoration: `isIndexable` gates the sitemap, the feed and the
search index on it, `listableTrips` gates the trip switcher, and `resolveViewer`
gates what the access panel advertises. Somebody who writes `listed: false` on a
public trip believing the documentation has advertised a trip they meant to
keep out of the sitemap, and nothing tells them.

Found while building B41, whose table test has to write `visibility: unlisted`
to get an unlisted public trip — see the comment on `TRIPS` in
`test/access-gate.test.ts`.

### What the Why missed

One thing found while building, and it decided the choice below: **the write
path already emits the key.** `createTrip` (`lib/tripWrite.ts`) put a `listed:`
line in every `trip.md` it wrote, `POST /api/v1/<user>/trips` takes `listed` in
the body (`app/api/v1/[user]/trips/route.ts:117`), and `/openapi.json`
documents it on both the request and the trip summary.

So the gap was wider than "documented and never read". An agent could `POST`
`{"visibility": "public", "listed": false}`, be answered `201`, read its own
file back saying `listed: false` — and the trip was in the sitemap. The
documentation was not describing a key nobody may set; it was describing a key
the software itself was writing and then ignoring.

`/openapi.json` also promised `listed` on every trip summary and `tripSummary`
(`lib/api/entries.ts`) never sent it, so there was no way to notice from
outside either.

## Work

Two shapes were offered, and the choice was the author's:

- **Read the key.** `parseTrip` honours an explicit `listed:` over the value
  derived from `visibility`, which makes the documentation true and lets a
  `guest` trip be advertised as existing without being readable.
- **Delete it from the documentation.** `listed` becomes a derived field that
  only the code names, `visibility: unlisted` is the way to say it, and
  `AGENTS.md` and `add-a-trip` stop describing a key nobody may set.

**Chosen: read the key, and let it narrow only.** Three reasons, in the order
they mattered.

1. Deleting it is not the smaller change once the write path is counted. It
   would mean taking `listed` out of `NewTrip`, out of the frontmatter
   `createTrip` writes, out of the REST body and out of two `/openapi.json`
   schemas — and every `trip.md` the API has already written would then carry a
   key the parser reports in `unknownFields`, so existing journals would start
   complaining about a line the software put there itself.
2. Reading it makes four surfaces agree at once instead of making four
   surfaces quiet.
3. The failing case is a person or an agent asking for *less* exposure and
   silently getting more. That is the direction a fix should never be shy
   about.

**Only ever narrows**, which is the second half of the decision and matters
more than the first. `listed: false` is honoured wherever it appears.
`listed: true` is honoured only where the visibility already advertises the
trip; on a `private`, `guest` or legacy `unlisted` trip it is refused and
logged, and `createTrip` refuses it up front with `invalid_listed` rather than
writing a file the reader would then disagree with.

That is deliberately narrower than the ticket's own sketch, which imagined
`listed: true` advertising a `guest` trip's existence. Doing that is not a
parser change at all — `isIndexable`, `listableTrips` and `resolveViewer` each
pair `trip.listed` with `visibility === "public"`, so all three would have to
be given an answer to "advertised, but shut", which is exactly the *"not doing:
changing what `listed` means anywhere it is consumed"* line below. Half-building
it — a field that reads `true` and that nothing consults — would have recreated
B51 pointing the other way. Captured as **B176** instead, with the per-surface
question written out.

Making the parser the choke point is the same move `parseVisibility` already
makes for an unrecognised value: the invariant in `Trip.listed` ("this only
narrows") is now true of the value itself rather than of the three places that
happen to remember to check `visibility` alongside it. A future consumer that
reads `trip.listed` on its own cannot be widened by a frontmatter key.

Also fixed, because they were the same disagreement: `tripSummary` now returns
`listed`, and `createTrip` writes the line only when it says something
`visibility:` has not already said — the same rule `test:` follows.

**MCP is not touched.** `create_trip` over MCP never accepted `listed` and its
schema is `additionalProperties: false`, so it refuses rather than ignores.
That asymmetry with REST predates this and is captured as **B175**.

Not doing: changing what `listed` *means* anywhere it is consumed.

## Acceptance

- A trip whose frontmatter contains `listed: false` behaves the same way as one
  written `visibility: unlisted` — or the documentation no longer says it may.
- A test that reads a real fixture file, in the shape of `test/visibility.test.ts`,
  pins whichever answer is chosen.
- `AGENTS.md`, `.claude/skills/add-a-trip/SKILL.md` and `lib/types.ts` agree
  with the parser.
