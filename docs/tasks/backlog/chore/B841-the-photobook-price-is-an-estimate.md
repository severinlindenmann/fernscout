---
id: B841
title: The photobook price is an estimate nobody has checked against a real Gelato quote
type: CHORE
priority: medium
complexity: low
area: photobook, pricing
found: "2026-09-07T16:19:48Z"
---

# B841 — The photobook price is an estimate nobody has checked against a real Gelato quote

## Why

`PHOTOBOOK_BASE_CREDITS` and `PHOTOBOOK_PAGE_CREDITS` in `lib/credits/pricing.ts`
are arithmetic against order-of-magnitude figures, and `PHOTOBOOK_PRICING_VERIFIED`
is `false` to say so. B840 raised the base from 90 to 160 and put the price on a
public pricing table labelled "an estimate", which is honest but is now a number
strangers read.

Gelato publishes no per-page rate. What is public is "from $11.85" for a
softcover including the first 30 inner pages, at the smallest format — ours is
210 x 210, 32-160 pages, perfect bound.

## Work

`GET https://product.gelatoapis.com/v3/products/{productUid}/prices` with a real
key and a real `productUid` — the one in `buildGelatoRequest()`
(`lib/photobook/providers.ts:168`) has the right shape and is not real. Quote
32, 52, 100 and 160 pages, both sizes, delivered to Switzerland. Then set the
two constants against it, flip `PHOTOBOOK_PRICING_VERIFIED` to `true`, and drop
"estimate" from the pricing table.

Blocked on a Gelato account, which is also what B108 needs.

## Acceptance

- A real quote for the four page counts recorded in `docs/providers/photobook.md`.
- `PHOTOBOOK_PRICING_VERIFIED` is `true` and `test/photobook-pricing.test.ts`
  asserts against the quoted figures.
