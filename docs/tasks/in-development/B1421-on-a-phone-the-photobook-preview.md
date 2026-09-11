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

## The tension, which must survive

B514 made the preview show spreads and B518 was found by it the same day — the
route map sitting in the fold, invisible until somebody looked at facing pages
together. A page-at-a-time view cannot become the only way a phone reader sees
the book, or that class of fault goes back to being invisible. Either keep the
fold band drawn at the page edges where a spread is split, or leave a way to
see the pair; say which in the ticket before building.

## Acceptance

At 390px, opening the preview shows one page filling the width, and swiping or
scrolling moves one page at a time through the whole book including the cover.
At 1024px nothing has changed: facing pages, the fold band between them. A
text page's body copy is legible on the phone without pinching.
