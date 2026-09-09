---
id: B1164
title: A book already bought printed offers to be printed again, at a different price
type: ISSUE
priority: high
complexity: medium
area: photobook, print, credits
found: "2026-09-09T22:05:00Z"
---

# B1164 — A book already bought printed offers to be printed again, at a different price

## Why

B1157 made one press buy a printed book. The order page was left as it was, and
it is still the old second checkout: for a book that has already been paid for
**printed and posted**, it shows the envelope, quotes the *print portion
only*, and offers a button to spend it again.

Measured on the live instance, order `efb1f315-…`:

```
payload.credits          205        ← what was actually paid
order page button        165        ← what it offers to charge now
```

So the same book carries two prices on two pages, and the smaller one is a
second charge for something already bought. The owner pressed it — the ledger
shows `-16500` then `+16500` — and it only cost them nothing because the
printer refused and the refund path is sound.

The discriminator the page needs does not exist yet: `payload.print` is written
both by the one-press purchase *and* by an agent's proposal on a book built
before B1157, so its presence cannot tell the two apart.

Found by the owner, in the words that matter: *"there is a button to print
again, remove that, also here are the credits wrong, first it says 205 now it
says here 165."*

## Work

- Mark the purchase: `payload.print.paid` set by `order/route.ts` when the
  print was bought with the book. Explicit, because nothing else in the payload
  distinguishes a paid print from a proposed one.
- `printOrder` refuses a `paid` order outright — a new `already_paid` failure
  — so the double charge is closed at the route and not only hidden in the UI.
- The order page becomes a receipt for such a book: where it went, what was
  paid, what the printer said. No buy button, no second quote.
- Where the printer refused, say so and say the money is back, and point at the
  wizard to order it again — there is one place that buys a book.
- Books built before B1157 keep the existing panel: they were paid for the
  build alone and printing them really is a separate purchase.

## Acceptance

- `/…/photobooks/<id>` for a book bought under B1157 shows no button that
  spends credits.
- The only price shown is the one that was paid.
- `printOrder` refuses an order whose print was already paid for, with a test.
- `npm run verify`.
