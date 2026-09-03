---
id: B87
title: A gallery page renders every photograph in the trip at once
type: FEATURE
priority: medium
complexity: medium
area: gallery, performance
found: "2026-09-03"
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
