---
id: B1425
title: A photobook is sold as one thing at one price, costed with VAT and a 50 percent margin
type: FEATURE
priority: high
complexity: medium
area: photobook, credits, pricing
found: "2026-09-11T07:39:10Z"
started: "2026-09-11T07:39:52Z"
session: 96a5b964-fad1-4616-9124-a01eabbd8a46
claimed: "2026-09-11T07:39:52Z"
---

# B1425 — A photobook is sold as one thing at one price, costed with VAT and a 50 percent margin

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

The owner's words: *"we don't charge for build or print, we charge the
customer for the full photobook, we just want a solid margin."* Today the
codebase charges for both halves separately and the customer meets the seam.

Three faults, one cause.

**The split leaks onto the page.** `priceOf(book)` is a flat build charge
(`PHOTOBOOK_BASE_CREDITS = 40`) that `test/photobook-pricing.test.ts:34`
deliberately asserts is *below* landed cost, because the print is supposed to
carry the margin. With no recipient there is no quote, so the panel falls back
to the build charge alone and calls it the price — B1423 is the label bug that
came out of exactly this. There is nothing to label correctly: a customer is
not buying a build.

**VAT is missing entirely.** `lib/photobook/gelato.ts` takes Gelato's `price`
as final; nothing anywhere adds tax. Gelato quotes ex-VAT, and this instance is
far below the CHF 100,000 Swiss registration threshold (`/admin` shows nothing
taken in), so input VAT is **not reclaimable** — it is a straight cost the
model does not know about. Swiss printed matter is 2.6%, carriage 8.1%.

**The margin is not what the comment thinks.** `PHOTOBOOK_PRINT_MARGIN = 1.5`
is applied to cost while the credit volume discount (up to 20%) is applied to
revenue, and the two never meet. Measured on the 46-page book a person
actually had on screen: landed CHF 23.01 incl. VAT, charged 205 credits =
CHF 41.00 list, **43.9% gross — and 29.9% for anybody on the full credit
discount**, under the 40-60% band print-on-demand resale runs at.

## The decision, already taken

One price for the whole object: **landed cost including VAT, times 2.0**,
targeting 50% gross at list. On the 46-page square softcover that is CHF 46.01
against OptimalPrint's CHF 46.90 and ifolor's ~CHF 54.70 delivered, so it sits
at market rather than under it.

The volume discount is **deliberately** allowed to erode this — the owner's
call, read as a volume rebate. A bulk buyer lands near 37.8% and that is
accepted, not overlooked. Do not add a second pricing rule to defend it.

## Work

- One number. Delete `PHOTOBOOK_BASE_CREDITS`, `photobookCredits()` and
  `priceOf()`; `BookQuote` loses `buildCredits` and `totalCredits` becomes the
  single price, computed from the live quote alone.
- Add VAT to the landed cost before the margin: print at 2.6%, carriage at
  8.1%. Name both rates as constants with what they are, not as bare numbers.
- `PHOTOBOOK_PRINT_MARGIN` 1.5 to 2.0, and rename it — it is the margin on the
  whole book now, not on the print.
- **With no quote there is now no price at all**, which is the right answer and
  closes B1423 on its own: nothing to mislabel. The panel shows the recipient
  sentence and no figure until a recipient exists. Remove
  `photobook.pricePrintOnly`, which B1406 added for a fallback that no longer
  exists.
- Rewrite `test/photobook-pricing.test.ts` against the new model: the measured
  basis stays, the assertion that the charge sits below landed cost goes.
- `PHOTOBOOK_BASE_CREDITS`'s doc block is stale in its own right (B1424) and
  is being deleted here, so B1424 goes with it.

**Not in this ticket.** No change to the credit tiers or the discount curve.
No change to what is submitted to Gelato. No VAT *charged* to anybody — this
instance is not registered, and the tax is a cost input, not a line item.

**Open, and worth a person's word later:** whether the Swiss tax office treats
a personalised photobook as a book at 2.6% or as standard-rated printed matter
at 8.1%. The difference on this book is CHF 0.74 of cost. Costed at 2.6% here;
if ESTV says otherwise the constant is one line.

## Acceptance

- A book with a recipient shows one price and one price only, and pressing the
  button spends exactly that.
- A book with no recipient shows no figure anywhere on the panel.
- The charge for the measured 52-page square book is twice its VAT-inclusive
  landed cost, within a rappen, and a test says so.
- `grep -rn "buildCredits\|priceOf\|PHOTOBOOK_BASE_CREDITS" lib app` is empty.
- `npm run verify` clean.

## Follow-up needed

`pricing.rowPhotobookPrintDetail` in `site/locales/hu.json` was set to the
English string rather than translated, because this session cannot write
Hungarian — the same rule as inventing a day, one level down. A native
Hungarian speaker should translate:

> "Your whole trip as a book, printed near the recipient and posted to
> whoever you choose. The price depends on the size, the page count and
> where it goes, and you see it before you order."
