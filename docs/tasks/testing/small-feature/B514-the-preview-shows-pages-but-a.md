---
id: B514
title: The preview shows pages, but a book is read in spreads
type: FEATURE
priority: medium
complexity: medium
area: photobook, preview
found: "2026-09-05T20:42:57Z"
started: "2026-09-05T20:47:27Z"
merged: "2026-09-05T20:59:11Z"
---

# B514 — The preview shows pages, but a book is read in spreads

## Why

`renderPreview` lays the pages out as a flat grid of single pages. A book is
not read that way. It is read as spreads: two facing pages, with a fold down
the middle and a gutter eating a few millimetres either side of it.

What that hides is exactly what the preview exists to catch. Two photographs
that clash across the fold. A route map whose halves do not join. A day's
opening page facing a full-bleed that fights it. A left-hand page whose gutter
is on the wrong side — the planner alternates it and nothing checks the result.

Page one is a recto and sits alone; after that they pair 2–3, 4–5, and so on.
The planner already knows all of this: `sideOf()` decides which hand every page
is, and the map spread is already built as two halves of one image.

## Work

Group the preview's pages into spreads and draw each pair together, with the
fold shown. Keep the single-page view available — proofing one page's bleed is
a different job from reading the book — so this is a way of looking rather than
a replacement.

The renderer does not change: the PDF is one page per page and every printer
wants it that way.

**Not doing:** simulating the curve of a perfect-bound page near the fold. The
gutter is already wider than the outer margin for that reason, which is the
part that matters on paper.

## Acceptance

- The preview can be read as spreads, page one alone and the rest in pairs.
- The route map's two halves are visibly one map.
- The single-page view is still there.
