---
id: B1469
title: A photobook order has no picture of the book it is an order for
type: FEATURE
priority: medium
complexity: medium
area: orders
found: "2026-09-11T14:18:13Z"
---

# B1469 — A photobook order has no picture of the book it is an order for

## Why

The order element has an `object` slot, and for a photobook it is empty: nothing
in this codebase renders a thumbnail of a built cover. The drafts hold the
layout without one (the size-and-cover block sits in that slot), so this is the
one genuinely new capability rather than a dependency of the redesign.

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
