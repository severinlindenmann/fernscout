---
id: B1598
title: "v2-canonical files are unreadable by lib/entries.ts and lib/trips.ts — the render layer has no step in the build order"
type: FEATURE
priority: high
complexity: high
area: API v2
found: 2026-09-12T00:00:00Z
---

## Why

The v2 migration's build order (`docs/v2-migration/03-build-order.md`) has six
steps, and every one of them is about routes. None of them touches the code
that *reads* content off disk to render the site.

That was safe while the on-disk frontmatter was expected to keep v1's key
names. On 2026-09-12 the owner lifted that constraint — breaking changes to
the file format are allowed, only `content/example/` has to be converted — so
the v2 serializer (B1596) writes a genuinely different file:

| | v1 on disk | v2-canonical on disk |
|---|---|---|
| day position | `lat:` / `lng:` | `coordinates: {lat, lng}` |
| day photographs | `gallery:` | `media:` |
| day draft state | `draft: true` | `status: "draft" \| "published"` |
| day weather | `weather: true` + `weatherData:` | one `weather:` key |
| day declines | `without:` / `unrecorded:` / `costs: false` | `declined: {}` |
| trip dates | `start:` / `end:` | `dates: {from, to}` |
| trip figures | `travellers:` | `figures:` |
| trip costs visibility | `costsVisibility:` in `trip.md` | `visibility:` inside the `costs` section of `trip.json` |
| trip rates | flat `rates: {EUR: 0.94}` | `rates: {currencies, manual}` |

**Since B1606 the gap is wider still: content on disk is now JSON, not
markdown at all.** The table above describes key names; the readers also have
to stop reaching for `gray-matter` and stop looking for `.md` files. A day is
`entries/YYYY-MM-DD-slug.json`, and `trip.md` + `costs.md` + `plan.md` are one
`trip.json`.

`readAllEntries` (`lib/entries.ts:255-371`) and `readTrip`
(`lib/trips.ts:577`) read none of the right-hand column. The day this
repository writes a v2 file is the day that file renders as an empty,
positionless, photographless day — or does not parse at all.

**This is not a route problem and no route step catches it.** `npm run
verify` will not catch it either: the fixtures are written in the shape the
readers expect. It shows up the first time somebody opens a page.

## Work

- Rewrite `readAllEntries` and `readTrip` to read the v2-canonical shape,
  reusing `dayFromJson`/`tripFromJson` from `lib/api/v2/documents.ts`
  (B1596/B1606 — storage moved from markdown to JSON on 2026-09-12) rather
  than a second parser beside it — the whole point of that module is that
  there is one.
- `Entry` and `Trip` in `lib/types.ts` are the render layer's own vocabulary
  and do **not** have to become the wire shape. Decide deliberately: either
  they stay and the readers map, or they collapse into the schemas' inferred
  types. Whichever, one mapping, in one place.
- `costsVisibility` moving into `trip.json`'s `costs` section and `travellers:` becoming
  `figures:` each have readers of their own (`lib/api/tripVisibility.ts`,
  `lib/travellers/parse.ts`, `components/Travelers.tsx`) — they move too.
- **This merge must also convert `content/example/`**, or land after the
  phase-3 replay has produced v2 content. Readers and content have to flip
  together in one merge; either alone leaves the site rendering nothing.
- Not doing: a dual-shape reader that accepts both. The whole migration is
  "as little legacy as possible", and a reader that tolerates v1 forever is
  the legacy.

## Acceptance

- A day and a trip written by `lib/api/v2/documents.ts` render correctly at
  `/{user}/trips/{trip}` and on the day page, checked in a browser at 390px —
  not only in a test.
- `content/example/` is v2-canonical and the local site renders it whole:
  journal home, trips index, each trip, each day, gallery, costs, feed,
  sitemap.
- Nothing under `lib/` parses `lat:`, `gallery:`, `draft:`, `without:`,
  `unrecorded:`, `start:`, `end:`, `travellers:` or `costsVisibility:` any
  more.

## Where it goes in the build order

Between step 3 (core document routes) and phase 3 (replay), or inside step 3.
It blocks anything visual: `test-in-a-browser` on v2 content is impossible
until this exists, and so is the render diff in `04-instruments.md`.
