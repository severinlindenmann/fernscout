---
id: B1740
title: Trip page hero shows no picture, and trip.cover is never used there
type: ISSUE
priority: medium
complexity: low
area: Trip story, trips index
found: "2026-09-14T16:17:50Z"
started: "2026-09-14T16:18:15Z"
merged: "2026-09-14T16:28:05Z"
---

# B1740 — Trip page hero shows no picture, and trip.cover is never used there

## Why

The owner reported that https://fernscout.ch/severin/trips shows a picture for
every trip card, while https://fernscout.ch/severin/trips/thailand-2025 shows
none. The two surfaces read different things:

- the card list passes `cover: trip.cover` straight from `trip.json`
  (`app/[user]/trips/page.tsx:326`);
- the trip page's hero never reads `trip.cover`. It takes the **first** image
  of the landing day's lead entry (`app/TripStory.tsx:396`), and when that day
  has no photograph `TripHero` drops the whole photo panel
  (`components/TripHero.tsx:342`). `trip.cover` is used on that route only for
  the Open Graph card (`app/[user]/trips/[trip]/page.tsx:53`), so the picture
  is right in a shared link and absent on the page itself.

Two things are wrong beyond the missing fallback. "First image of the day" is
the wrong end: the freshest photograph of a day is its last, and on an active
trip the hero should be the picture that was just taken. And `trip.cover`, once
somebody sets one, has no effect anywhere except the index card and the share
card — nothing falls back to it.

Owner's decision on precedence (2026-09-14):

- **Index card** — `trip.cover` wins when set; otherwise the last picture of
  the trip. A card is never blank while the trip has any photograph.
- **Trip page hero** — the last picture of the landing day always wins, so an
  active trip shows today's newest photograph and a set cover does not freeze
  it. `trip.cover` is the fallback for a landing day with no photograph.

`getDefaultDay` (`lib/entries.ts:464`) already makes the landing day "the last
day that has happened", so no status branch is needed: it is today's day on an
active trip and the final day on a finished one.

## Work

- `app/TripStory.tsx` — `findLast` instead of `find` for `heroCover`, and a new
  optional `cover` prop as the fallback.
- `app/TripStory` callers (`app/[user]/trips/[trip]/page.tsx` and the current
  trip's page) — pass `trip.cover`.
- `app/[user]/trips/page.tsx` — card `cover` becomes
  `trip.cover ?? <last image of the trip>`, using `getAllMedia` (newest first,
  `lib/entries.ts:586`) with the reader's own read level from `readByTrip`, so
  a fallback cover is never a photograph this reader may not see.

## Acceptance

- A trip page whose landing day has photographs shows that day's **last**
  image in the hero, with or without `trip.cover` set.
- A trip page whose landing day has none, but whose trip has a `cover`, shows
  the cover.
- A trip card with no `trip.cover` shows the trip's last picture; with one, it
  shows the cover.
- The fallback picture respects photograph visibility for the reader.
- `npm run verify` green, plus a browser capture of a real existing trip page
  and the trips index at 1280 and 390.

## What was built

**Valid** — confirmed on disk before building: `app/TripStory.tsx:396` read
`gallery.find((g) => g.type === "image")` on the landing day and nothing else,
and `trip.cover` appeared on this route only in `generateMetadata`.

Two things in **Work** turned out to be wrong and were built differently:

- **No prop threading.** `TripStory` already holds the whole `Trip` from
  `TripProvider` (`const trip = useTrip()`, line 84), so `trip?.trip.cover` is
  the fallback in place. The four call sites — both story pages and both day
  pages — are untouched.
- **No status branch, for the reason the Why gives**: `getDefaultDay` already
  lands on the last day that has happened, so `findLast` on the landing day is
  "today's newest photograph" on a trip in progress and "the trip's last
  photograph" on a finished one, from one expression.

`writeTripFixture` gained a `cover` field (`test/fixtures/content.ts`), applied
to the written document the way `accent` and `tagline` already are —
`createTrip` refuses `cover` on purpose and documents why.

## Evidence

- `test/hero-cover.test.tsx`, five keepers. Reverting `findLast` to `find`
  fails the first two and nothing else, so they are pinned to this behaviour
  rather than passing incidentally.
- `npm run verify` green: 606 files, 7740 tests, knip clean.
- Browser, on content that predates the branch —
  `/example/trips/asia-2023` at 1280 and 390 (`/tmp/b1740/`). The hero draws
  `last-week-hanoi/03.jpg`, the landing day's **last** picture: not `01.jpg`
  (the old behaviour) and not the trip's `cover`
  (`/media/asia-2023/mekong-slow-boat/01.jpg`), which is the precedence this
  ticket specifies. `/example/trips` at both widths still shows each card's
  set cover. No console errors; the one failed request is
  `/api/reactions` 404, which is unrelated and present before the branch.
- Security: the only visibility-relevant line is the card's fallback, which
  reads at this reader's own level; the closed default covers a trip absent
  from that map. A test asserts a `private` photograph is never offered.
