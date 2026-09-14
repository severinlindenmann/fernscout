---
id: B1722
title: The hero chat has finished animating before it is scrolled to, and the photobook drawing does not read as a book
type: ISSUE
priority: medium
complexity: low
area: landing
found: "2026-09-14T11:00:00Z"
started: "2026-09-14T10:13:18Z"
merged: "2026-09-14T10:21:47Z"
---

# B1722 — The hero chat has finished animating before it is scrolled to, and the photobook drawing does not read as a book

## Why

**The animation.** `ChatVignette`'s bubbles are staged with CSS
`animation-delay`, counted from first paint. On `/agent` that is right: the
vignette is the first thing on the page. On the landing page it sits below the
headline, the lede and two buttons — at 390 width it is roughly a screen down,
so by the time a reader scrolls to it the last bubble landed seconds ago and
they see a finished, static conversation. The one thing the drawing is for —
watching a day get written — only plays for a reader who never scrolls.

**The photobook.** B1717 drew it as an open spread with ruled lines standing in
for prose. On the page it reads as two photographs with a gap between them and
some stray hairlines: the fold is a pale band rather than a fold, there is no
cover, no thickness and no paper, and nothing says "printed object". The
postcard beside it works because it is a *thing* — tilted, with a back behind
it. The book should be a thing too, and it should show that there is more than
one size to print.

## Work

1. **Play on sight.** Pause the staged animation until the vignette is
   actually in view, then let it run once. `animation-play-state: paused`
   pauses the delay phase as well, and `animation-fill-mode: both` already
   holds the `from` state, so a paused bubble sits at opacity 0 with no extra
   rule to hide it. An `IntersectionObserver` removes the hold. Under
   `prefers-reduced-motion` the existing `animation: none` still wins and
   everything is visible at rest — the hold must not reintroduce a hidden
   state there.
2. **Redraw the book as a printed object**, in the same register as
   `PostcardProof`: a photo-covered book with a visible spine and page block,
   and a second book behind it in a different format. Both at real
   proportions from `BOOK_SIZES` in `lib/photobook/spec.ts` — square is
   200 × 200 and portrait is 210 × 280 — so the drawing cannot promise a shape
   the printer does not make.

## What was built

**Valid** — `ChatVignette`'s delays are inline `animation-delay` values, and
`LandingSections` renders it below the hero's headline, lede and buttons.
Confirmed in a browser: after seven seconds at scroll 0 all four bubbles had
already animated.

- `.fs-hold-animation` in `globals.css` — `animation-play-state: paused` on
  the container and everything inside it. Nothing hides anything: `both` on
  `.fs-assemble-in` already holds the `from` state, so a paused bubble sits at
  opacity 0 on its own. Deliberately **not** listed in the reduced-motion
  block, where `animation: none` already leaves every bubble visible at rest.
- An `IntersectionObserver` in `ChatVignette` takes the class off the first
  time any of it enters the viewport, then disconnects. A browser without the
  API releases immediately rather than holding a conversation nobody can
  start. `/agent` is unchanged: the vignette is on screen at first paint, so
  the observer fires at once.
- The photobook is now two books rather than a spread — a square 200 × 200 in
  front with a spine and a cut page block, a portrait 210 × 280 behind it, both
  photo-covered. It says "printed" and "there is a choice of size", which the
  ruled-line spread said neither of.

Measured in a browser at 390: held at opacity 0 and `paused` after 7 s without
scrolling; scrolled into view, the first bubble at 0.9 s and all four by 6 s.

## Acceptance

- Scrolling the landing page to the vignette starts the bubbles from the
  first one, every time the page is loaded and scrolled.
- `/agent`, where the vignette is already in view on load, is unchanged.
- With `prefers-reduced-motion: reduce` every bubble is visible at rest with
  no observer involved.
- The photobook card reads as a printed book at 1280 and at 390, in both
  themes, and its proportions come from `BOOK_SIZES`.
- `npm run verify` passes.
