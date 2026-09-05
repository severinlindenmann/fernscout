---
id: B519
title: The preview's map has no place names but the printed one does
type: ISSUE
priority: low
complexity: low
area: photobook, preview
found: "2026-09-05T20:56:48Z"
started: "2026-09-05T20:59:39Z"
merged: "2026-09-05T21:19:43Z"
---

# B519 — The preview's map has no place names but the printed one does

## Why

`drawRoutePage` in `lib/photobook/render.ts` labels the stops — it measures the
text, flips a label to the other side of its dot when it would run off the
paper, and skips labels for stops that belong to the facing page. `routeSvg` in
`lib/photobook/preview.ts` draws land, the graticule, the route line and the
dots, and no names at all.

So the printed map names its stops and the preview does not. Nobody is misled
about anything dangerous — the preview is about placement and the placement is
right — but it is one more thing the preview says differently from the page,
and this file exists to not do that. The cost showed up immediately: reading
the spread view to check the map, the first question was "which stop is that?"
and the preview could not say.

Noticed while checking B514.

## Work

Draw the labels in the preview, from the same rule the renderer uses: right of
the dot, left when it will not fit, skipped when the dot belongs to the facing
page.

The measurement is the awkward part — the renderer has `measure()` for
Helvetica at a size, and the browser has its own idea of the width of a string.
Exact agreement is not the goal and is not achievable; agreement about *which
stops are named and on which side* is.

**Not doing:** moving the labelling rule into `plan.ts` so both draw from one
description. That is the right long-term shape and it is a bigger change than
this is worth on its own — say so here if it is chosen anyway.

## Acceptance

- The preview's map names the same stops the printed map names.
- A label near an edge is on the same side in both.
