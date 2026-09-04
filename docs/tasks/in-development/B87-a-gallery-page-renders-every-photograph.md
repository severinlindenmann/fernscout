---
id: B87
title: A gallery page renders every photograph in the trip at once
type: FEATURE
priority: medium
complexity: medium
area: gallery, performance
found: "2026-09-03"
started: "2026-09-04T15:49:34Z"
session: 67c9cca1-5b74-49e7-b1a4-dbee6bf7ce21
claimed: "2026-09-04T15:49:34Z"
---

# B87 — A gallery page renders every photograph in the trip at once

## Why

`/[user]/gallery` hands `GalleryGrid` every picture in the trip in one array —
`getAllMedia(tripId)` at `app/[user]/(trip)/gallery/page.tsx:45` — and
`components/GalleryGrid.tsx:58` maps the whole thing to tiles. Nothing
paginates, nothing windows, nothing defers. A trip's gallery is as long as the
trip.

The example journal does not show this: its current trip has five pictures and
the page is 90 KB. The trip this is actually for does not look like that.
`ingest-photos` imports a folder off a camera, several photographs per day, and
a three-week trip lands in the hundreds. Four things scale with that number and
three of them are not the images.

**The RSC payload carries a copy of the day for every photograph on it.**
`getAllMedia` (`lib/entries.ts:289–293`) flat-maps to `{ item, entry }` — the
whole `Entry`, and `Entry` has `content` (`lib/types.ts:70`) and
`translations` (`:71`). A day with thirty pictures serialises that day's full
prose thirty times, in every language the journal is written in. The grid uses
`entry.location` and `entry.date` and nothing else (`GalleryGrid.tsx:104,107`).

**Every tile is a motion node.** `motion.button` with an entrance transition
per tile (`:59–66`), and the stagger is capped at 0.4s
(`delay: Math.min(i * 0.03, 0.4)`), so past tile 14 they all animate together —
the animation stops being a stagger and becomes a few hundred simultaneous
transitions, most of them off screen.

**Every clip is a `<video>` element.** `:75–81` mounts one per video tile.
`preload` is `"none"` when there is a poster, which is the good case and is
usually true — but the elements are all in the DOM regardless.

**The filter chips are the whole location list.** `:50–54` renders one chip per
distinct location with no overflow behaviour beyond a horizontal scroll, and on
a long trip that is a strip nobody can reach the end of.

The images themselves are the part that is already handled: `next/image` lazy
loads below the fold and `sizes` is set correctly (`:91`). This is about
everything wrapped around them.

## Work

Two changes, and they are independent — either is worth doing alone.

**Stop shipping the day with the picture.** Give the grid a projection —
`{ src, type, poster, width, height, location, date, slug }` — instead of the
`Entry`. `MediaEntry` is exported from `GalleryGrid.tsx:13`; find its other
callers before changing it. This costs nothing visually and is most of the
payload.

**Render a window, not the whole trip.** Preference is a "load more" button
over infinite scroll, and over numbered pages: a button keeps the URL stable,
keeps the back button working, and does not fight the lightbox's index — which
is an index into `shown` (`:32–38`) and would have to keep meaning the same
thing. Whatever the mechanism, the lightbox must still walk the *whole*
filtered set, not just what has been rendered, or opening the last visible
picture and pressing › ends the gallery early.

Pick the batch size against a real trip, not the example. Something like 60.

Not doing: infinite scroll, virtualisation, or a route change. The page stays
one URL and one component.

Related: B16 is the lightbox's own problems (no swipe, no position indicator)
and is a separate task — do not fold it in here.

## Acceptance

- A trip with several hundred photographs renders a first screen without
  putting every tile in the DOM, and more arrive on demand.
- The RSC payload for the gallery page no longer contains any day's prose. Grep
  the payload for a sentence from an entry and find nothing.
- Opening the last rendered picture and paging forward reaches pictures that had
  not been rendered yet, and wraps to the first at the end of the *filtered*
  set.
- The location filter still filters across the whole trip, not across what has
  been loaded.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.

## Built

**A — the projection.** `lib/types.ts` gets `MediaTile` (src, type, caption,
width, height, poster, location, country, countryCode, date — the entry
fields the tile and the open viewer read, not the entry). `getAllMedia`
(`lib/entries.ts`) now builds this directly instead of `{ item, entry }`.
`GalleryGrid`'s `MediaEntry` export is gone; both it and `GalleryPageContent`
take `MediaTile[]` from `lib/types` instead — one name for one shape, not an
alias kept for compatibility. `FullPhoto` and the lightbox caption read the
flat fields (`open.location`, `open.country`, …) instead of `open.entry.*`.

**B — the window.** `GalleryGrid` keeps a `visibleCount` state, batch **60**
(chosen against "a three-week trip lands in the hundreds" from this task's own
Why, not the 5-photo example), and renders `shown.slice(0, visibleCount)`. A
"load more" button (new key `gallery.loadMore`, all three locales,
`npm run i18n:keys` re-run) adds another 60 when `visibleCount < shown.length`.

`shown` itself is unchanged — the full filtered array, over the whole trip's
`media`, never over what's rendered. That is what makes the lightbox able to
walk past the rendered window for free: its `index`/`count`/wrap math
(`prev`/`next`) already operates on `shown`, and `shown[openIndex]` exists
whether or not that tile has been mounted into the grid. The only piece I
added is a render-time adjustment — `if (openIndex !== lastOpenIndex) {
setLastOpenIndex(openIndex); if (openIndex + 1 > visibleCount)
setVisibleCount(openIndex + 1); }` — so the grid catches up to whatever the
viewer has actually looked at, rather than leaving a gap once it closes.
(Tried a `useEffect` for both this and the filter-change reset first; eslint's
`react-hooks/set-state-in-effect` correctly flagged synchronous `setState` in
an effect body, so both use React's documented "adjust state during
rendering" pattern instead — a `[lastX, setLastX]` shadow state compared each
render, no effect.)

Filter chips (item 4 in Why) and the video-preload behaviour (item 3) were
left alone — item 3 is naturally addressed by the window (fewer videos ever
mount), item 4 is a separate, undocumented-in-Work concern; not touched.

## Verified

All four required commands pass (`npm run build`, `npx tsc --noEmit`, `npx
eslint .`, `npx vitest run` — 167 files, 2450 passed, 3 skipped; the 4
remaining eslint warnings are pre-existing and unrelated, confirmed against
`git stash`).

Acceptance, checked against a fixture trip (10 entries × 30 photos = 300,
`traveler/bigtrip`) rendered by a real `next dev` server and a real Chrome tab
(not just code-reading):

- **Windowed DOM.** The SSR HTML has exactly 60 tile buttons
  (`.grid > button`), not 300; a real browser click on "Load more" took it to
  120. `0` `<video>` elements mounted beyond what's visible (fixture was
  images only, so this reduces to "60, not 300," which is the same claim).
- **RSC payload, for `getAllMedia`'s own contribution:** fetching
  `/traveler/gallery` and grepping for a marked sentence and nine filler
  sentences (one written into each of the 10 entries) finds each **exactly
  once**, not once per photo (30 photos on the marked entry — a leftover
  `{item, entry}` shape would have shown 30 copies of one sentence). One
  occurrence per entry is the fingerprint of a *different*, pre-existing leak
  I found while checking this — see below.
- **Lightbox reaches unrendered photos, and wraps the filtered set.**
  Clicked the last of the 60 rendered tiles (opened at "60 / 300"), pressed ›
  once: moved to "61 / 300" and the grid grew to 61 tiles — a photo the grid
  had never rendered. Pressed › 238 more times: reached "300 / 300", grid at
  300 tiles. One more press: wrapped to "1 / 300", the newest photo — the
  start of the *filtered* set, not the rendered window.
- **Filter runs over the whole trip.** Clicking the "Faro" chip (day 1 of 10,
  entirely outside the initial 60-tile window since the grid orders
  newest-first) showed all 30 Faro tiles, no "load more" (30 < 60) — the
  filter option list and its results both come from the full `media` array.

**Found, not fixed here — filed as B309.** The gallery page ships a *second*
copy of every entry's prose regardless of `getAllMedia`: `getPlaces(tripId)`
(same page) returns `Place[]`, whose `entries: Entry[]` is the full entry,
and `GalleryPageContent` forwards it to `SlideShow` (for the narrated-cut
audio track) as `places`. That crosses the server/client boundary — and lands
in the RSC payload — for every reader whether or not they ever press play.
Confirmed on the same fixture: all 10 entries' sentences appear, once each,
regardless of photo count per entry — the fingerprint of `Place.entries`, not
`getAllMedia`. `WorldMap.tsx`'s detail panel has the identical shape of
problem on `/[user]/map`. Out of scope for B87 (Work section named
`getAllMedia` specifically, and this is a real feature — the slideshow
narration — not needless duplication), so it is not what "no day's prose" in
this task's acceptance line can mean in full; B309 covers it.
