---
id: B16
title: The day photo viewer does not answer to touch and never says where you are
type: ISSUE
priority: medium
complexity: low
area: gallery, a11y
found: "2026-09-01"
---

# B16 — The day photo viewer, on a phone

## Why

Opening a photograph on a day gives you `components/Gallery.tsx`. It is better
than it looks from the outside: there are ‹ and › buttons at
`components/Gallery.tsx:107` and `:117`, and `useLightbox` binds
ArrowLeft/ArrowRight and PageUp/PageDown on the dialog itself
(`components/useLightbox.ts:60–68`). So a reader with a keyboard can already
move between pictures without closing and reopening.

A reader on a phone cannot, which is nearly all of them:

- **No swipe.** `grep -n "touch\|swipe\|drag"` across `Gallery.tsx`,
  `GalleryGrid.tsx` and `SlideShow.tsx` returns nothing. The only way forward
  is to hit a 44px chevron pinned to the screen edge, which is also where the
  browser's own back gesture lives.
- **No position.** Nothing says "3 of 9", so there is no way to know whether
  swiping — if it worked — would be worth it, or that you have reached the end
  and wrapped around to the first picture again. `prev`/`next` wrap silently
  (`components/Gallery.tsx:21–27`).
- **No sense that there is a sequence at all.** No thumbnail strip, no
  progress. Opened from the grid it reads as a single picture that happens to
  have arrows near it.

The trip-level `components/SlideShow.tsx` is the opposite: 750 lines, a
narrated cut, a full tour, autoplay, speed control, wake lock. But it takes
`places` and is only mounted from the gallery and map pages
(`app/[user]/(trip)/gallery/GalleryPageContent.tsx:50`,
`app/[user]/(trip)/map/MapPageContent.tsx:158`). None of that reaches a day.

## Work

In `components/Gallery.tsx` and `components/GalleryGrid.tsx` — both, or the
same reader gets two different viewers on two pages:

1. Horizontal swipe to advance and go back. `motion/react` is already imported
   in both; a drag constraint with a velocity threshold is the small version
   of this and does not need a new dependency.
2. A position indicator — "3 / 9".
3. Decide about wrapping. Silent wrap plus no counter is why the end of a
   gallery is invisible; a counter may be enough on its own.
4. Consider a thumbnail strip along the bottom for a day with many photos. Do
   this only if it survives a phone in portrait, which is where it will
   actually be used.

Do not reach for `SlideShow` here. It is built around a trip's `places` and
carries the whole presentation bundle; a day gallery loading it to show four
pictures is the wrong trade.

Keyboard behaviour and the focus trap in `useLightbox` must not regress — read
the docblock at the top of that file first. It exists because both viewers and
the story pager once listened on `window` and one press of → moved the picture
*and* the day.

## Acceptance

- On a touch device, swiping left and right in an open photograph moves
  between the day's photographs, on both the day gallery and the trip gallery
  grid.
- The open photograph says which one of how many it is.
- Arrow keys, Escape, the focus trap and focus return to the thumbnail all
  still work — the existing behaviour `useLightbox` documents.
- Swiping does not fire when the open item is a video with controls.
