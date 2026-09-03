---
id: B51
title: A trip's listed frontmatter key is documented and never read
type: ISSUE
priority: medium
complexity: low
area: trips, content
found: "2026-09-01"
started: "2026-09-03T19:24:38Z"
session: 0c03d994-da58-4a02-ab85-107825393b1a
claimed: "2026-09-03T19:24:38Z"
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

## Work

Two shapes, and the choice is the author's:

- **Read the key.** `parseTrip` honours an explicit `listed:` over the value
  derived from `visibility`, which makes the documentation true and lets a
  `guest` trip be advertised as existing without being readable.
- **Delete it from the documentation.** `listed` becomes a derived field that
  only the code names, `visibility: unlisted` is the way to say it, and
  `AGENTS.md` and `add-a-trip` stop describing a key nobody may set.

The first is more useful and the second is smaller. Either is better than the
present state, where one is documented and the other is implemented.

Not doing: changing what `listed` *means* anywhere it is consumed.

## Acceptance

- A trip whose frontmatter contains `listed: false` behaves the same way as one
  written `visibility: unlisted` — or the documentation no longer says it may.
- A test that reads a real fixture file, in the shape of `test/visibility.test.ts`,
  pins whichever answer is chosen.
- `AGENTS.md`, `.claude/skills/add-a-trip/SKILL.md` and `lib/types.ts` agree
  with the parser.
