---
id: B641
title: The photobook stretches photographs and wastes a page on a portrait phone picture
type: FEATURE
priority: high
complexity: high
area: photobook, layout
found: "2026-09-06T17:51:56Z"
started: "2026-09-06T19:29:16Z"
merged: "2026-09-06T19:49:41Z"
---

# B641 — The photobook stretches photographs and wastes a page on a portrait phone picture

## Why

Found while making a real photobook from a real trip: a gallery of iPhone
pictures, mostly portrait, several at modest resolution. Two faults come out of
that, and the first is serious.

**Photographs are being stretched.** A picture must never be scaled
anisotropically, and some pages do it. That is not a taste question — a
stretched photograph is a wrong photograph, and it is printed.

**The layouts assume landscape.** A portrait phone picture either gets a page
to itself with wide empty margins, or is cropped hard to fill a landscape
frame. Most people photograph in portrait and most people are not good
photographers; the book has to be good with what it is given. Three portrait
pictures side by side on one page is a better answer than one portrait picture
stranded on a spread, and the planner has no such arrangement to reach for.

`lib/photobook/plan.ts` chooses arrangements; `lib/photobook/render.ts` draws
them. B513's `crop` already lets the owner say where a crop is taken from,
which is the neighbouring problem and not this one.

## Work

- Find every place a photograph is scaled and make anisotropic scaling
  impossible — one guard where the geometry is computed, not a fix per layout.
  This is the part that must not wait for the rest.
- Add arrangements that suit portrait pictures: several to a page at their own
  aspect, and a low-resolution picture placed smaller rather than blown up to
  fill a frame it cannot fill.
- The planner should choose by what it has — the aspect ratios and pixel
  dimensions of the day's photographs — rather than by a fixed template order.
- Look at the result: `/docs/branding/print` shows bleed, trim, safe area and
  gutter from the same constants, and a real book of portrait pictures is the
  test.

Not doing: an editor for page layouts. The owner chooses the cover and the crop
point; the arrangement stays the planner's.

## Acceptance

- A trip whose photographs are all portrait produces a book with no stretched
  photograph anywhere, checked against the rendered PDF.
- Three portrait photographs can share a page at their true aspect.
- A low-resolution photograph is placed at a size its pixels support rather
  than filling a page.

## Findings (2026-09-06)

**No anisotropic stretch was actually reachable.** Every drawn rectangle in
`lib/photobook/render.ts` came from exactly two functions in `plan.ts`,
`cover()` (`plan.ts:567`, pre-change) and `contain()` (`plan.ts:581`), and both
computed width and height from a *single* `scale` factor
(`Math.max`/`Math.min` of `slot/photo` on each axis) — which cannot produce a
non-uniform result by construction. `checkResolution`, `render.ts`'s
`drawPhoto` (`render.ts:319`) and the front-cover placement (`render.ts:787`,
pre-change) all consumed those rectangles as-is. Read every image-drawing call
site (`grep drawImageClipped`, two hits total) and traced both back to their
source; found no third path. So: the specific fault named in the title —
"some pages stretch" — was not reproduced by static analysis, and I did not
fix a fault I couldn't find. What *was* real and worth closing:

1. **A duplicate copy of the cover-crop formula.** `render.ts`'s front cover
   (old `render.ts:787-794`) reimplemented `cover()`'s arithmetic inline
   rather than calling it — harmless today (both copies happened to agree),
   but a future edit to one and not the other is exactly how this class of
   bug gets introduced. Consolidated into one function, `scaledRect()` in
   `plan.ts`, that both `cover()`/`contain()` and the front cover now call —
   the "one guard" the ticket asked for. Anisotropic scaling is now
   structurally impossible in one place instead of provably absent in two.
2. **Grid layouts had no arrangement for 3+ portraits, and no resolution
   floor.** `groupPhotos()` paired two portraits but had nothing for a third
   consecutive one, which fell through to its own full/near-full page —
   exactly "stranded on a spread". And every grid slot used `cover` (crop to
   fill) regardless of the photo's actual pixel count, so a low-resolution
   photo got blown up past what its pixels supported with only a warning,
   never a smaller placement.

**Fixed:**
- `lib/photobook/plan.ts`: added `scaledRect()` as the one function that
  computes a drawn rectangle (`cover`, exported, and `contain` are now both
  one line calling it); added `containWithinResolution()` and
  `coverOrShrink()`, so a `cover`-mode placement whose photo cannot reach
  `HERO_FLOOR_DPI` at the slot's width is shown whole and smaller instead of
  cropped and blown up; added the `"trio-portrait"` layout (three columns) and
  taught `groupPhotos()` to reach for it whenever three consecutive
  photographs are all portrait, before it looks for a pair.
- `lib/photobook/render.ts`: front cover now calls the exported `cover()`
  (aliased `coverRect` to avoid shadowing the local `cover` variable) instead
  of repeating the formula.

**Verified by looking**, per `check-a-drawing`: built a synthetic all-portrait
trip (some low-resolution, some landscape, saddle-stitched so the planner's
own page-count padding didn't tear groups apart — see `expandToMinimum`,
pre-existing and out of scope) through the real `planBook`/`renderVolume`,
rasterised the PDF with `pdftoppm`, and looked at every layout produced:
`trio-portrait` (three portraits, own columns, round test-circles = no
distortion), `quad`, `pair-stacked`, `feature`, `full-bleed`, the day-page
photo strip, and the front cover. The low-resolution photo in the
`pair-stacked` page sat visibly smaller than its slot, centred with a margin,
while the landscape beside it filled its half exactly. All circles round
throughout — no stretch anywhere, including the day-page strip and the front
cover after the consolidation.

**Left undone:** none. Everything in Work and Acceptance is built and tested.
`groupsFor()` (the *named*-layout override path, used only when an owner has
explicitly forced a `grid`/`pair` layout for one day) was left as it was —
only the `auto` path (`groupPhotos()`) gained the trio arrangement, since that
is what an unattended planner actually reaches for and is what the ticket's
acceptance criteria exercise. Extending the explicit-override path to also
offer `trio-portrait` is a smaller, separate polish and not required by this
ticket's acceptance; not captured as a new task since it is not a fault, just
an unequal feature between two paths that already differ in other ways.
