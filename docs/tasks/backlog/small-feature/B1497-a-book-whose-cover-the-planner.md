---
id: B1497
title: A book whose cover the planner picked cannot show it anywhere outside the preview frame
type: FEATURE
priority: low
complexity: medium
area: photobook
found: "2026-09-11T17:38:19Z"
---

# B1497 — A book whose cover the planner picked cannot show it anywhere outside the preview frame

## Why

Found building B1488. The order page and the buy panel both show a cover plate
from `options.cover` — the photograph the *owner* picked. Most books have none:
leaving the cover alone lets the planner choose, and that choice is recorded
nowhere the browser can reach.

The plan does know it — `volume.cover.frontPhoto.file` in `lib/photobook/plan.ts`
— but `BookPhoto.file` is a path relative to whichever root holds the bytes
(trip media, originals, or the inbox), deliberately opaque to the planner and
not a URL. Turning it into one means the source that resolved it saying so.

So a plate appears on a minority of books, and on the rest the layout falls
back to the size-and-binding block. That is the drawn fallback and it holds,
but the drawing shows a plate on every book.

## Work

`app/[user]/photobook/preview/route.ts` returns the planned cover as a media
URL beside `ratio` and `credits` — the source knows which root it read the file
from, so the URL is its to build, not the planner's. Then `BookLevelView` and
`photobookOrderView` fall back to it when `options.cover` is unset.

Not doing: rasterising the built cover PDF, which is what would show the title
over the photograph. That was decided against in B1469 and the reasoning has
not changed.

## Acceptance

A book with no chosen cover shows the planner's pick in the buy panel and on
its order page; a trip whose photographs have gone still shows the block and
nothing broken.
