---
id: B641
title: The photobook stretches photographs and wastes a page on a portrait phone picture
type: FEATURE
priority: high
complexity: high
area: photobook, layout
found: "2026-09-06T17:51:56Z"
started: "2026-09-06T19:29:16Z"
session: e5f23c58-bb87-4175-ad7b-5d3aed93169f
claimed: "2026-09-06T19:29:16Z"
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
