---
id: B1421
title: On a phone the photobook preview is two pages wide and too small to read
type: FEATURE
priority: medium
complexity: medium
area: lib/photobook/preview.ts, app/[user]/(trip)/photobook/ReadTheBookView.tsx
found: "2026-09-11T07:34:00Z"
started: "2026-09-11T07:54:29Z"
session: 975594e4-e8d1-4286-bab8-0faa7d0d368f
claimed: "2026-09-11T07:54:29Z"
---

# B1421 — On a phone the photobook preview is two pages wide and too small to read

## Why

Both preview layouts show a **spread** — two facing pages side by side — and
size it to the width of whatever is showing it:

- the composer's strip, `lib/photobook/preview.ts:761`,
  `.spread { flex:0 0 96% }` swiped horizontally;
- the reading view, `:797`, `.spread { width:100% }` scrolled down, opened
  from `ReadTheBookView.tsx`.

On a 390px phone that makes each page about 190px across. A square 21 cm book
renders at roughly a fifth of life size, so the body copy on a text page is
sub-pixel and a photograph's caption is a grey smear. This is the last look
somebody takes before spending money on a printed object, and on a phone it
tells them almost nothing about what will arrive.

## Work

At phone width, page through the book **one page at a time**, each page filling
the frame, scrolled or swiped from one to the next. The spreads grouping stays
the print unit everywhere else and at every wider width.

The mechanism is already mostly there and should not be rebuilt: the document
already carries `data-view="pages"` (`:669`) which unwraps `.spread` with
`display:contents` so every page is its own box, and the strip already uses
native `scroll-snap-type` rather than a JS pager. A media query and a snap
rule are likely the whole of it — no second server round-trip, and no
component that re-implements swiping.

Decide and write down where the cut is (a `@media` width inside the preview
stylesheet, or a class the composer sets), because the frame's own aspect
ratio is computed for a spread and a one-page view wants the other one.

Not doing: any change to what the renderer puts on paper, or to the desktop
layouts.

## Validity

**Valid**, re-read 2026-09-11. `lib/photobook/preview.ts:761` still sizes a
spread to 96% of the composer's strip and `:797` to 100% of the reading view,
both with the two pages sharing that width. Nothing had overtaken it.

## What was decided, and by whom

A person looked at a running draft of both layouts and the three zoom options
before this was built, and chose:

- **The reading view only.** The composer's strip stays as it is — see the
  scope note below.
- **Pinch and double-tap on the page itself**, over leaving zoom to the
  browser or a double-tap toggle alone. The reasoning is in the Work section.

## The tension, which must survive

B514 made the preview show spreads and B518 was found by it the same day — the
route map sitting in the fold, invisible until somebody looked at facing pages
together. A page-at-a-time view cannot become the only way a phone reader sees
the book, or that class of fault goes back to being invisible. Either keep the
fold band drawn at the page edges where a spread is split, or leave a way to
see the pair; say which in the ticket before building.


## What was built

Four changes, no second request and no new component.

1. **`lib/photobook/preview.ts`** — an `@media (max-width:640px)` block at the
   end of the reading-view rules. The spread becomes `display:contents`, the
   same unwrap `data-view="pages"` has always used, and each `.page` takes the
   width with `scroll-snap-align:center`. Every selector in it carries
   `body.bare.read`, which is what keeps the composer's strip and B534's day
   slice on facing pages.
2. **A `.zoom` layer** inside each `.sheet`, wrapping everything printed on
   the page. It is `position:absolute;inset:0`, so every percentage inside it
   and the sheet's own container-query units resolve exactly as before, and a
   pinch has one thing to transform while the sheet stays the window.
3. **The gesture**, in the document's own script, bound only where the body
   carries `read`. Pointer events, a 3x ceiling, a pan clamped to the sheet,
   and a double-tap that zooms toward the tap rather than the middle.
   `touch-action:pan-y` on the page is what lets one finger still scroll the
   book while two fingers zoom. The book is an iframe and no browser zooms an
   iframe's contents independently of the page around it, so this is handled
   here or not at all.
4. **`useSpreadKeys`** stepped from `.spread`, which has no box once it is
   `display:contents` — the arrow keys would have moved the book 24px. It
   steps from `.page` on the y axis, which is the same number wherever the
   pages are still paired.

One thing moved that is worth knowing about: the drill-in listener is no
longer bound in the reading document at all. It used to be held off by
`pointer-events:none` on the figure, and a phone needs those taps back for the
pinch. The guarantee is stronger where it is now — there is no listener to
fire — but it is in the script rather than the stylesheet.

## Acceptance

At 390px, opening the preview shows one page filling the width, and swiping or
scrolling moves one page at a time through the whole book including the cover.
At 1024px nothing has changed: facing pages, the fold band between them. A
text page's body copy is legible on the phone without pinching.

## Evidence

The reading view's own document, rendered from `example/asia-2023` — 34 pages
of a trip that existed long before this branch — and driven in headless
Chrome at 390 x 780.

- `/tmp/b1421-shots/tmp-b1421-read-html-390.png` — one page per stop, page one
  (the title, a recto that stands alone) at the full width, body copy on the
  intro page legible without pinching. 0 console errors, 0 failed requests.
- `/tmp/b1421-shots/tmp-b1421-read-html-1280.png` — unchanged: the solo recto
  at half width, then facing pairs with the fold band down the seam.
- `/tmp/b1421-shots/zoomed-390.png` — the route page double-tapped at 2.5x
  toward the tap. "Zurich" and the graticule are readable; this is the page
  class B518 was about.
- Gesture, measured rather than assumed: page 366 x 388 at a 390 viewport;
  double-tap in gives `scale(2.5)` and out gives no transform; a two-finger
  pinch reaches the 3x ceiling and releasing back to life size clears it;
  `.spread` computes to `display:contents`; 34 pages in the DOM; and
  `figure.drillable` is 0, so the reading view binds no drill-in.

One fault the screenshots caught and a test could not: the fold band is a
`::before` on the spread, and a `display:contents` element still generates its
pseudo — with `position:relative` no longer applying to it, the absolutely
positioned band escaped to the viewport and painted a dark stripe down the
whole screen. Hidden in the same media query.

`npm run verify` — all five steps green (519 test files, 6798 tests).
