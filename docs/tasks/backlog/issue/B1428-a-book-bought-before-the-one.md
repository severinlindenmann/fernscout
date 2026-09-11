---
id: B1428
title: A book bought before the one-price change would be charged the whole price again to print it
type: ISSUE
priority: medium
complexity: low
area: photobook, credits, print
found: "2026-09-11T08:12:26Z"
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
