---
id: B841
title: The photobook price is an estimate nobody has checked against a real Gelato quote
type: CHORE
priority: medium
complexity: low
area: photobook, pricing
found: "2026-09-07T16:19:48Z"
started: "2026-09-08T06:07:07Z"
merged: "2026-09-08T06:07:08Z"
completed: "2026-09-09T16:47:47Z"
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

## Outcome (2026-09-08) — already done, lane move was missed

The block ("blocked on a Gelato account") lifted: `GELATO_API_KEY` is set on
the instance, and the quote endpoint was driven on 2026-09-07 as part of the
photobook pricing work.

- `docs/providers/photobook.md` carries the real ex-VAT CHF prices, quoted
  2026-09-07, one copy printed in Switzerland — including CHF 10.68 for a
  52-page pocket and CHF 14.40 print + 8.52 Swiss Post for the 200 × 200
  softcover this ticket asked about.
- The product uids in `lib/photobook/spec.ts` are verbatim from
  `products:search`, not constructed — the ticket's "has the right shape and
  is not real" is fixed. 210 × 210 turned out to be a size Gelato does not
  print at all; the sizes are 140, 200, 210 × 280 and 280.
- `PHOTOBOOK_PRICING_VERIFIED` is `true`, and `PHOTOBOOK_BASE_CREDITS` is 40
  with printing quoted live per order rather than approximated by a per-page
  rate — so the ticket's `PHOTOBOOK_PAGE_CREDITS` no longer exists.
- `test/photobook-pricing.test.ts` asserts the flag and that the charge sits
  between the measured landed cost and twice it.

Nothing was left to do here. **No order has ever been placed** — these are
quote-endpoint prices, which is B108's business and not this ticket's.
