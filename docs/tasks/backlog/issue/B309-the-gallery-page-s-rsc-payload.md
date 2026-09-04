---
id: B309
title: The gallery page's RSC payload carries every entry's full prose for a slideshow nobody has opened
type: ISSUE
priority: medium
complexity: medium
area: gallery, performance
found: "2026-09-04T16:03:02Z"
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
