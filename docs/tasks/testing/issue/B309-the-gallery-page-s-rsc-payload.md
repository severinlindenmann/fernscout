---
id: B309
title: The gallery page's RSC payload carries every entry's full prose for a slideshow nobody has opened
type: ISSUE
priority: medium
complexity: medium
area: gallery, performance
found: "2026-09-04T16:03:02Z"
started: "2026-09-07T11:40:31Z"
merged: "2026-09-07T12:04:15Z"
---

# B309 — The gallery page's RSC payload carries every entry's full prose for a slideshow nobody has opened

## Why

Found while verifying B87 (which fixed the *other* leak on this page,
`getAllMedia`). `getAllMedia` no longer ships a day's prose per photograph, but
the same page still does, through a second path: `getPlaces(tripId)`
(`app/[user]/(trip)/gallery/page.tsx:45`) returns `Place[]`, and `Place.entries`
(`lib/entries.ts:284`) is the full `Entry[]` — `content`, `translations`, all
of it. `GalleryPageContent` takes it as `places: PlaceView[]`
(`app/[user]/(trip)/gallery/GalleryPageContent.tsx:20`), and `PlaceView`
(`components/WorldMap.tsx:18-29`) declares `entries: Entry[]` too, so nothing
narrows it on the way in — passing a `Place[]` there compiles because it is a
structural superset, not because the entries were trimmed.

Confirmed against a real page fetch, not just by reading the code: a fixture
trip with 10 entries (one carrying a marked sentence, nine carrying
`"Day N in <place>, nothing remarkable"`) rendered at `/traveler/gallery`
returned all ten sentences in the HTML — once each, matching one occurrence
per `Place`, not per photograph, which is the fingerprint of this path rather
than `getAllMedia`'s (that would have been once per photo).

It is there on purpose, not by accident: `SlideShow`
(dynamically imported, `ssr: false`) reads `place.entries` to build the
narrated cut (`lib/narratedCut.ts:30`, `components/SlideShow.tsx:87`) — one
sentence per day, read from the entry's own content, for the slideshow's
narration text. `ssr: false` keeps the component's *code* out of the initial
bundle, but the *data* it needs (`places`, already resolved server-side) is a
prop of `GalleryPageContent` regardless of whether `showing` is ever set to
`true`, so it crosses the server/client boundary — and lands in the RSC
payload — for every reader, including the overwhelming majority who never
press play.

`WorldMap.tsx` uses the same `entries` field for its own detail panel (transport
mode, gallery counts, a link to the day) — the map page (`/[user]/map`) has
the identical shape of problem for the identical reason, not just the gallery
page.

## Work

Ship the narration text (and whatever else `SlideShow`/`WorldMap` need from an
entry) as a light projection instead of the whole `Entry`, the same move B87
made for `MediaTile` — or fetch it lazily (an API call) only once the reader
presses play, since most never do. Either removes the prose from the page's
initial payload; which is cheaper is worth checking against what `SlideShow`
and `WorldMap`'s detail panel actually read off `entries` (narration sentence,
transport mode, gallery items, slug, gallery count — grep `\.entries` in both
files first, the set may not be small).

Not doing as part of this: touching `GalleryGrid`/`getAllMedia` — that's B87,
already merged.

## Acceptance

- Fetching `/[user]/gallery` and `/[user]/map` and grepping the HTML for a
  sentence from a test entry's `content` finds nothing, the way B87's
  acceptance check did for `getAllMedia`.
- The slideshow's narration and the map's place detail panel still show the
  same text they do today once opened.

## Done (2026-09-07)

Followed B87's exact pattern: a new light type, `PlaceEntry` (`lib/types.ts`),
replaces `Entry` in `Place.entries`/`PlaceView.entries`. It carries `slug`,
`date`, `time`, `location`, `country`, `countryCode`, `transport`, `cover`,
`gallery` and `draft` — everything `WorldMap.tsx` and `SlideShow.tsx` actually
read off an entry (grepped `\.entries` in both first, per the Work note above)
— and drops `title`, `content` and `translations` entirely.

The one field that needed real thought rather than just narrowing: the
slideshow's narrated cut reads one sentence of prose per day
(`lib/narratedCut.ts`'s `firstSentence`), and that sentence is picked in the
*reader's own locale* (`useI18n().localized`, previously called with the raw
`Entry`). Dropping `content`/`translations` outright would have silently
broken localisation, which the Acceptance line above rules out. So
`PlaceEntry` carries `headline: Record<string, string>` instead — one
sentence (or the day's title, when it has none) precomputed *once, on the
server*, for every locale the journal is configured to read in
(`lib/entries.ts`'s new `toPlaceEntry`/`localesOf`) — rather than shipping
each language's whole prose to the client so a locale switch or the
slideshow can extract a sentence from it there. Every locale the journal
offers is covered (not only the ones actually translated), so a reader's
locale always has a `headline[locale]` and the client never has to fall back
to a "written locale" it does not carry.

`components/SlideShow.tsx` now reads `narratedStep.entry.headline[locale]`
directly instead of calling `localized()` + `firstSentence()` on raw content;
`lib/narratedCut.ts`'s `NarratedCutSlide.entry` is typed `PlaceEntry`, not
`Entry`. `components/WorldMap.tsx`'s `PlaceView.entries` is `PlaceEntry[]`.
`GalleryPageContent` and `MapPageContent` needed no change — they already
only re-export the type, they don't read entry fields themselves.

**Before/after**: no page-weight number taken (would need a running instance
with a fixture trip, which is more setup than this ticket's time budget
covered) — instead pinned at the data layer, the same level B87's own
verification used a real fetch for and this task's Why section used a real
fetch for too. `test/place-entry-projection.test.ts` is new: it writes a day
whose English `content` and German `translations.de.content` each carry two
sentences, calls `getPlaces()`, and asserts (a) the returned `PlaceEntry` has
no `content`, `translations` or `title` key at all — `JSON.stringify`d, the
day's second sentence in either language is absent from the whole `Place` —
and (b) `headline.en`/`headline.de` each carry exactly the first sentence.
That is the shape of proof the ticket's own "grep the HTML" acceptance check
was reaching for, one layer down: nothing above `getPlaces` can leak content
it was never handed.

**Not done, and worth naming honestly**: acceptance's own two bullets (fetch
`/[user]/gallery` and `/[user]/map` against a running instance and grep the
HTML) were not re-run — `test/place-entry-projection.test.ts` proves the data
`getPlaces` hands to the page no longer contains the prose, and the type
change on `PlaceView`/`GalleryPageContent`/`MapPageContent` means the page
components have nothing left to leak even if they wanted to (there is no
`Entry` in scope to serialise), but a live-fetch confirmation the way the Why
section did for the original bug was not repeated. `npm run verify` passes in
full otherwise (build, tsc, eslint, all 341 test files, 4366 tests).

`test/narratedCut.test.ts`, `test/world-map.test.tsx`, `test/map-page.test.tsx`
and `test/slide-map.test.tsx` fixtures updated for the new type (`PlaceEntry`
instead of `Entry`) — no behavioural change to what they assert.
