---
id: B1331
title: The pricing table sells a PDF-only photobook the owner says is not offered
type: ISSUE
priority: medium
complexity: low
area: pricing
found: "2026-09-10T16:08:11Z"
---

# B1331 — The pricing table sells a PDF-only photobook the owner says is not offered

## Why

The public pricing table (`components/Pricing.tsx`, row `pricing.rowPhotobook`)
advertises "Ein Fotobuch, als PDF gesetzt" for 40 credits as its own
purchasable line. The owner says this is not a service we offer as a
standalone product — the photobook is sold printed. The charge itself is real:
`lib/photobook/build.ts:85` charges `photobookCredits()` (40, from
`PHOTOBOOK_BASE_CREDITS` in `lib/credits/pricing.ts`) per volume when the PDF
is built, split from the print charge by B841.

Cost of leaving it: the published table promises a product the owner does not
want sold, and once the row is removed the printed book's advertised "ab"
price is understated — the table's print example quotes 172 credits
(CHF 34.40, print + ship × margin) while a buyer actually pays build + print
= 212 credits (CHF 42.40) for their first printed copy.

## Work

- Decide with the owner: is the PDF-only build purchasable at all, or is the
  40-credit build charge folded into a printed order only?
- Remove the `pricing.rowPhotobook` row from `components/Pricing.tsx` and the
  three locales (row label + detail strings, `npm run i18n:keys`).
- Make the printed-book row's example price include whatever a first order
  actually costs, read from the same constants that charge it — never a typed
  number.
- If the standalone PDF purchase path is to be closed, that is its own
  follow-up against the photobook flow, referenced by id from here.

## Acceptance

- The pricing table on `/` and `/docs` shows no PDF-only photobook row.
- The printed photobook example price equals what
  `lib/photobook/build.ts` + `photobookPrintCredits(PHOTOBOOK_QUOTE_EXAMPLE…)`
  would actually charge for that example order.
- `npm run verify` green (locales + i18n union regenerated).
