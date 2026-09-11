---
id: B1428
title: A book bought before the one-price change would be charged the whole price again to print it
type: ISSUE
priority: medium
complexity: low
area: photobook, credits, print
found: "2026-09-11T08:12:26Z"
started: "2026-09-11T08:33:28Z"
session: 96a5b964-fad1-4616-9124-a01eabbd8a46
claimed: "2026-09-11T08:33:28Z"
---

# B1428 — A book bought before the one-price change would be charged the whole price again to print it

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Found while verifying B1425, which collapsed the build charge and the print
charge into one price for the whole book.

`printOrder` (`lib/photobook/print.ts:337`) is the pre-B1157 flow: a book
bought back when the order paid for the **build alone** could be printed later
by paying the print separately. Its own comment says so, and B1164 added
`if (print.paid) return … "already_paid"` so a book bought printed cannot be
charged twice.

That guard still holds. What no longer holds is the *price it quotes to the
books the guard lets through*. It calls `photobookPriceCredits`, which since
B1425 returns the price of the **whole book** — there is no print portion any
more, because there is no split. So a legacy order, which already paid 40
credits for its build, would be asked for the entire new price on top.

On the live instance, `print_orders` holds **eleven** photobook rows with
`credits: 40` and no `print.paid` — all on the `example` demo journal, so no
real customer is exposed. They are reachable: the order page's print route
does not exclude them.

Concretely, for a 46-page square book: the owner paid 40, and pressing print
would now ask for 231, making 271 for an object the new model prices at 231.
Before B1425 it would have asked for 165, making 205. The overcharge is the
old build fee, counted twice.

## Work

The honest options, and this is a person's call rather than an obvious fix:

- **Refuse them.** Under one price a half-paid book has no coherent price, so
  `printOrder` returns something like `legacy_order` and the page says the book
  predates the current pricing and should be ordered again. Cleanest, and it
  is what the single-price model actually implies.
- **Credit the 40.** Charge `photobookPriceCredits(...) - payload.credits`, so
  a legacy owner pays the difference and lands on the same total as everybody
  else. Kinder, and one line, but it keeps a second pricing rule alive for a
  population of eleven demo rows.
- **Delete the path.** If nothing outside the demo journal has ever used it,
  `printOrder` and its route could go, and with them `already_paid`,
  `stale_quote` and a chunk of `print.ts`. Check the other journals first.

Whichever: the stale comment at `print.ts:306-311` still describes the old
split ("165 against the 205 that had been paid") and must be rewritten or
removed with the code it explains.

**Not in this ticket.** No change to `photobookPriceCredits` or to the B1157
one-press flow. The new price is correct; only this legacy door is wrong.

## Acceptance

- A photobook order with `credits: 40` and no `print.paid` cannot be charged
  the full new price.
- Whatever is decided is written where a reader of `print.ts` meets it, and
  the B1164 comment no longer describes a split that does not exist.
- `npm run verify` clean.

---

## Decided 2026-09-11 — delete the legacy print path; one VAT rate, measured off a real invoice

The owner's words: *"remove everything that is legacy, no legacy code, and
mwst take 2.6%."* So of the three options above, the third: the path goes.

**Nothing real is lost.** Every photobook order on the instance belongs to the
demo journal — 58 rows carrying the old build-only charge and one bought
through the current one-press flow. No other journal has ever ordered a book,
so no person loses a door they were using.

**The VAT question went through three readings before a real invoice settled
it.** First, "mwst take 2.6%" was read as folding the standard rate on
carriage into the reduced rate on the book — one rate at 2.6% on both. Then,
on the owner's correction, as the two rates staying exactly as they were
(2.6% print, 8.1% shipping), on the theory that Gelato bills them
separately. Neither survived a real invoice. A Gelato invoice for a 30-page
200×200 softcover, Swiss Post Economy, dated in this session's window, reads:

    Subtotal   1 Item                 10.86 CHF
    Shipping   Swiss Post Economy      8.52 CHF
    Discounts  50% off offer          -5.43 CHF
    Tax        8%                      1.13 CHF
    Total                             15.08 CHF

`1.13 / (10.86 + 8.52 - 5.43) = 8.10%` — one rate, charged on the book and the
carriage *together*, after discounts, reconciling to the rappen. Gelato does
not treat this as reduced-rate printed matter at all; it bills the whole
shipment at the standard rate. So: **one constant**,
`PHOTOBOOK_VAT_RATE = 0.081`, replacing both
`PHOTOBOOK_PRINT_VAT_RATE` (0.026) and `PHOTOBOOK_SHIPPING_VAT_RATE` (0.081),
applied to print and shipping summed together rather than per component —
measured, not inferred, and with the evidence recorded beside the constant
rather than left as something a later reader has to take on faith.

**The 50% discount on that invoice is deliberately not in the cost basis.**
It was an introductory offer, and pricing this journal's margin on a
promotional rate that can end at any time would be a margin built on sand.
Do not "correct" the constants downward to match the discounted invoice —
the pre-discount figures (10.86, 8.52) are the ones this file already used
and are what the formula is checked against.

**The same invoice validates the stored cost formula on real money**, as a
side effect of settling the VAT question: `6.04 + 0.161 × 30 = 10.87`
predicted, `10.86` billed — one rappen out, same order of accuracy as the
28-page check already in `lib/credits/pricing.ts`.

New floor: **CHF 36.20** (was 35.20 before this ticket; the two intermediate
figures floated during this ticket — 34.40 and 35.20-unchanged — were both
wrong and never shipped).

## Work, as decided

Delete, do not deprecate:

- `printOrder` and everything only it used, in `lib/photobook/print.ts` —
  including the `already_paid`, `stale_quote` and `not_built` outcomes that
  exist only for it. `submitBuiltBook` stays: the current one-press flow uses
  it.
- `app/[user]/photobooks/[id]/print/route.ts` — the owner's legacy press.
- `lib/photobook/propose.ts` and `app/api/v1/[user]/photobooks/[id]/print/`
  — proposing a print only ever led to that press. With the press gone the
  proposal leads nowhere, so it goes too.
- `proposePrint` in `lib/photobook/orders.ts`, and the `print.paid` flag now
  that there is no second charge for it to guard against.
- The operation for `/api/v1/{user}/photobooks/{id}/print` in
  `lib/api/openapi.ts`, and any mention in `/agent.md`. **A route deleted from
  the code and left in the contract is worse than either.**
- Every comment describing the split — `orders.ts:77` still explains "165
  credits against the 205 that had been paid".

`PHOTOBOOK_PRINT_VAT_RATE` and `PHOTOBOOK_SHIPPING_VAT_RATE` fold into one
`PHOTOBOOK_VAT_RATE = 0.081`, applied to `printMinor + shipMinor` together —
see "Decided" above for the invoice this is measured off. The comment records
the evidence, not an inference, and states it as settled: no hedge, no open
question to revisit later.

Leave the 58 stored rows alone. They are built books whose PDFs still
download; they simply have no print door any more, which is correct — the
object they half-paid for is not one this instance sells.

## Acceptance, as decided

- `grep -rn "printOrder\|proposePrint\|already_paid\|stale_quote\|print\.paid\|PHOTOBOOK_PRINT_VAT_RATE\|PHOTOBOOK_SHIPPING_VAT_RATE" lib app test` is empty.
- `/openapi.json` does not describe a route that no longer exists, and
  `test/openapi-contract.test.ts` passes.
- The floor on the public pricing table reads CHF 36.20.
- A 46-page square softcover prices at 238 credits (CHF 47.60).
- `npm run verify` clean.
