---
id: B1164
title: A book already bought printed offers to be printed again, at a different price
type: ISSUE
priority: high
complexity: medium
area: photobook, print, credits
found: "2026-09-09T22:05:00Z"
started: "2026-09-09T19:43:06Z"
merged: "2026-09-09T19:56:43Z"
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

## Evidence

Checked on a row shaped exactly like the two on the live instance — `credits:
205`, a `print` block, `failure: refused` — because that is the case the owner
met and a fixture with a happier shape would not have found it.

Before: the envelope, "Druck CHF 13.43 + Porto CHF 8.52 = 165 Credits", and
**Jetzt drucken — 165 Credits**. After:

```
Your order
Four days round the Alps — 52 pages, Square 200 × 200 mm
  book-interior.pdf   book-cover.pdf
Printing
The printer would not take this order. All 205.00 credits are back on your
account, and the files below are yours. Order the book again from the trip's
photobook page when you want to try once more.
```

No button, and the only number is the one that was paid.
`/tmp/b1164-final/…-1280.png`.

`printOrder` refuses `already_paid` with a test that also asserts the balance
does not move and nothing reaches the printer — the route is closed, not just
the button hidden.

The heading changed too: "Print this book" is an offer, and this page has
nothing to sell for a book already bought. A book built before B1157 keeps it,
because printing one really is still a purchase.

## The two rows already on the live instance

`efb1f315-…` and `f37f667a-…` were written before `paid` existed, so they carry
no flag and would still show the button after this deploy. They need it set
once, by hand:

```sql
update print_orders
set payload = jsonb_set(payload::jsonb, '{print,paid}', 'true')::text
where owner_id = 'severin' and kind = 'photobook'
  and payload::jsonb ? 'print'
  and (payload::jsonb ->> 'credits')::int > (payload::jsonb -> 'print' ->> 'quotedCredits')::int;
```

The condition is the honest discriminator for rows that predate the flag: a
purchase that included the print cost more than the print alone. Not used in
code — a numeric inference is the wrong thing to decide money on — only to
find the handful of rows that need the flag they were written without.
