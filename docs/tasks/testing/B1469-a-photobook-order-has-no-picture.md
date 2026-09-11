---
id: B1469
title: A photobook order has no picture of the book it is an order for
type: FEATURE
priority: medium
complexity: medium
area: orders
found: "2026-09-11T14:18:13Z"
started: "2026-09-11T15:31:22Z"
merged: "2026-09-11T15:36:28Z"
---

# B1469 — A photobook order has no picture of the book it is an order for

## Why

The order element has an `object` slot, and for a photobook it is empty: nothing
in this codebase renders a thumbnail of a built cover. The drafts hold the
layout without one (the size-and-cover block sits in that slot), so this is the
one genuinely new capability rather than a dependency of the redesign.

## What was built, and how it differs from the Work below

**The plate is the photograph the cover was ordered with, not a render of the
printed cover**, and the difference is worth stating: the book's title is set
over that photograph in the PDF, and drawing *that* means rasterising the built
cover page. This project has no rasteriser and pulling one in — a PDF renderer,
a headless Chrome, a Ghostscript — for a thumbnail is a dependency and a build
step against a decoration. `sharp` cannot read a PDF.

So the slot shows `options.cover`, which the order already carries when the
owner chose a cover, served through the media route that already gates on the
owner. Two consequences, both acceptable and both visible on the bench:

- **A book whose cover the planner picked has no plate.** The order records
  nothing in that case, and the size-and-binding block stands — which is what
  the layout was drawn to survive.
- **A photograph removed since the order shows the block, never a broken
  image.** `resolveMediaFile` is asked before the URL is rendered.

Pruning (B483) is not a concern after all: the photograph lives in the trip's
media, not in the order's directory, so nothing sweeps it with the PDFs.

A true cover render is still possible and is not captured — it would want a
rasteriser and a real reason, and "the receipt could be prettier" is not one
yet.

## Work

A cover thumbnail from the built cover PDF, written beside the order's files at
build time so nothing renders on request. Served through the existing
`app/[user]/photobooks/[id]/[file]/route.ts`, which already gates on the owner.

Pruning (B483) must take it with the PDFs, and an order whose thumbnail is gone
shows the spec block again rather than a broken image.

## Acceptance

A newly built book shows its cover on the order page; an order built before this
ticket shows the spec block and nothing broken; a pruned order shows the spec
block. If a new route is added, `/openapi.json` describes it — see the
`keep-the-contract` skill.
