---
id: B1331
title: The pricing table sells a PDF-only photobook the owner says is not offered
type: ISSUE
priority: medium
complexity: low
area: pricing
found: "2026-09-10T16:08:11Z"
superseded: "B1157/B1164 already made the book one purchase; B1332 removed the table row"
---

# B1331 — The pricing table sells a PDF-only photobook the owner says is not offered

## Why

The public pricing table advertised "Ein Fotobuch, als PDF gesetzt" for 40
credits as its own purchasable line, and the owner said that is not a service
we sell.

## What was found (2026-09-10)

The product already agrees with the owner — the advertisement was the only
seller:

- **No purchase path sells a PDF-only book.** The order flow
  (`app/[user]/photobook/order/route.ts`) requires a recipient
  (`no_recipient` without one) and charges `quote.totalCredits` — build plus
  print — in one press. `lib/photobook/quote.ts` (B1157) states it outright:
  "There is deliberately no files-only price, because there is no files-only
  product." B1164 marked the print paid inside that same order so nothing can
  charge it twice.
- `POST /api/v1/<user>/photobooks/<id>/print` proposes printing an
  *already-built* order and spends only the print quote — the build was paid
  when that order was made. Neither `/openapi.json` nor `/agent.md` offers a
  PDF-only purchase.
- The stale advertisers were the pricing-table row (removed by B1332, which
  also repriced the printed row to build + print, ab CHF 42.40) and the
  `photobookCredits()` comment in `lib/credits/pricing.ts`, which still said
  "somebody who only ever wants the PDF pays CHF 8.00" — corrected on this
  ticket (merge b1331-pdf-comment): the build charge is a component of one
  price, not a product.

Nothing remains to build.
