---
id: B16
title: The day photo viewer does not answer to touch and never says where you are
type: ISSUE
priority: medium
complexity: low
area: gallery, a11y
found: "2026-09-01"
started: "2026-09-04T06:30:09Z"
merged: "2026-09-04T07:17:24Z"
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

## What was built

**One viewer, not two.** The Work section says "both, or the same reader gets
two different viewers on two pages", and the two lightboxes had already drifted
— text glyphs against lucide icons, `max-h-[80vh]` against `[78vh]`. Rather
than copy the swipe and the counter into both, the chrome moved into
`components/Lightbox.tsx`: the backdrop, the three buttons, the counter, the
drag, and the call to `useLightbox`. `Gallery.tsx` and `GalleryGrid.tsx` keep
what actually differs — the picture and whatever is printed under it, passed as
children. Each is about fifty lines shorter. The day gallery inherits the trip
gallery's lucide icons, which is the visible change to a reader who is not
swiping.

**1. Swipe.** `motion/react`'s `drag="x"`, constrained to its own origin with
`dragElastic`, so the picture gives and springs back. `components/swipe.ts`
holds the decision and nothing else: 60px of travel, or 400px/s with at least
16px of it, and a long drag that ends in a flick the other way follows the
flick. It is a pure function so the thresholds can be argued with in a test
rather than only in a browser.

**2. The position.** "3 / 9" on a pill at the bottom, `tabular-nums` so it does
not jitter as it counts, with the sentence "Photo 3 of 9" for a screen reader
in an `aria-live="polite"` region — for a reader who cannot see the photograph
the counter is the only evidence the swipe did anything. New key
`a11y.photoPosition`, in all three shipped dictionaries.

**3. Wrapping stays** (Work item 3). The counter was enough on its own: "1 / 9"
after "9 / 9" reads as a loop, where the same jump with nothing on screen read
as the viewer losing its place. With one photograph there is no counter and no
chevrons — nowhere to go, and "1 / 1" tells a reader what they can already see.

**4. No thumbnail strip** (Work item 4, "only if it survives a phone in
portrait"). It does not, at 390px: the strip and the picture want the same
vertical space, and the counter answers the question the strip was there to
answer. Not done, deliberately.

### The bug that only a browser would have shown

Tests said the drag was wired and the drag did nothing. `<img>` is a native
drag source, so a mouse-down on the photograph started the browser's own
drag-and-drop and swallowed every pointer event after it — the gesture never
began. `draggable={false}` on the image is the fix, and it is invisible from a
phone (no native drag from a finger) and total on a laptop. It is commented
where it lives, in `components/FullPhoto.tsx`.

**Found in the same pass:** both chevrons were painted *behind* the picture.
Positioned siblings paint in document order, the frame comes after the buttons,
and on a phone the photograph is the full width of the screen — so the only
control this task says a reader has was underneath the thing it moves. `z-10`
and a dark disc behind each.

### Driven, not only tested

`npm run dev`, Chromium at 390×844, the example journal:

| | |
| --- | --- |
| `/example/trips/asia-2023/day/hue-to-hoi-an` | drag left → `1 / 4` becomes `2 / 4`, again → `3 / 4`, drag right → `2 / 4`, a 20px drag → unchanged and the viewer stays open |
| `/example/trips/asia-2023/gallery` | the same, `1 / 22` → `2 / 22`, so the trip grid behaves as the day does |
| `…/day/mekong-slow-boat`, item 5 of 5 | a clip: the frame reports `touch-action: auto` — no drag on a video with controls |
| keyboard, unchanged | → `2 / 4`, ← `1 / 4`, ← again `4 / 4` (the wrap, now legible), PageDown moves the picture and `window.scrollY` does not move, Escape closes and focus returns to the thumbnail |

Thirteen cases in `test/gallery-viewer.test.tsx` hold it: the thresholds,
`touch-action:pan-y` in the server's own markup for a photograph and its
absence for a clip, the counter in both forms, no counter at `count: 1`, and
`role="dialog"`/`aria-modal`/`tabindex="-1"` still on the overlay so the
`useLightbox` contract cannot regress silently.
