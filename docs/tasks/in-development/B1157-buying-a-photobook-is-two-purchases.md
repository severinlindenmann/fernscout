---
id: B1157
title: Buying a photobook is two purchases with the decision after the money
type: FEATURE
priority: high
complexity: high
area: photobook, credits, print
found: "2026-09-09T21:35:00Z"
started: "2026-09-09T19:01:14Z"
session: ce87fdc2-3f66-428c-90d3-ae9d8df84e40
claimed: "2026-09-09T19:01:14Z"
---

# B1157 — Buying a photobook is two purchases with the decision after the money

## Why

The owner presses **Mit Credits bezahlen**, spends 40 credits, and receives two
PDFs. Somewhere below that is a thin link — *Dieses Buch drucken und
verschicken →* — leading to a second page and a second payment of 165 credits.
205 credits for one object, across two screens, with the word *bestellen*
attached to the half that only renders a file.

Everything about the ordering is backwards:

- **Who it goes to, and what postage costs, is decided after the money.** The
  first payment happens before anybody has said where the book is going, or
  whether it can be posted at all.
- **The panel says printing is impossible.** `photobook.orderNotPrinted` is
  rendered unconditionally (`BookLevelView.tsx:365`) and has been false since
  Gelato was switched on. Captured as B1156.
- **A PDF was never the product.** The owner's words: *"it was never about
  generating a PDF photobook … the idea was always that he just directly can
  buy it and the pdf is after the purchase is already confirmed."*

The pieces are right and the order is wrong. Building really does cost
something, the print really is a separate call, and refunds really do need to
be per-part — none of which has to surface as two purchases.

Drafted and agreed with the owner on 2026-09-09, including the decision that
settles the shape: **either they buy the printed book or they get nothing.**
There is no files-only product.

## Work

One product, one price, one press.

- **`lib/photobook/quote.ts` (new).** Build credits + print + postage for one
  book and one recipient, in one place, so the preview and the order route
  cannot come to different totals.
- **`preview/route.ts`** takes an optional `contactId` and answers with the
  total. The page already re-previews on every change, so choosing a different
  recipient re-quotes for their country.
- **`BookLevelView.tsx`** shows the envelope, one total and one button. The
  owner is preselected; anybody else is behind the existing disclosure.
- **`order/route.ts`** takes the `contactId`, re-derives the same total and
  holds B595's stale-price check against it, then claims → builds → spends the
  whole total → writes `payload.print` → submits to the printer.
- **`lib/photobook/print.ts`** gains `submitBuiltBook`, the submit half on its
  own, for a book that has already been paid for in full. `printOrder` is left
  alone: it is the button on the order page and is what books built before this
  change still use.
- **A refused print refunds everything.** Not the print half — the whole
  amount. The files are not what was sold, so the render is ours to absorb.

Two things that must not move:

- **The build still happens before the spend** (B509). Reversing it cost 357
  credits on the live instance in one afternoon.
- **The agent API is unchanged.** `POST …/photobooks/…/print` still proposes
  and still cannot press.

## Acceptance

- One button on the wizard buys a printed book, at a price that includes
  postage to the person named on the panel.
- The PDFs appear after the purchase, on the receipt and in the mail.
- A printer refusal returns the full amount and says so.
- No path sells a PDF on its own.
- `npm run verify`, and the flow driven in a browser end to end.

## Evidence

Driven in a real browser against the local `example` journal — a trip this
branch did not write — with a live Gelato key.

**The panel**, in the order the money is decided in: what the book is → who it
is going to → what that costs → the button.

```
Order this book
28 pages · Square, 20 × 20 cm
The spine is printed with "Four days round the Alps · 2024".
                    GOING TO
                  Alex Berger
                   Feldweg 18
              5512 Wohlenschwil
                  Switzerland
▸ Send it to someone else?
183 credits — about CHF 36.60, printed and posted
You have 100000 credits
Pressing this builds the book and sends it to the printer. You get the two
PDFs — inside and cover — here and by email.
[ Order the book — 183 credits ]
```

**Pressed it.** One press produced, in order: a Gelato quote, a claim, a built
book, **one** charge, and a real order at the printer.

```
credit_ledger   -18300  photobook          ← one line, 183 credits
print_orders    print_submitted
                provider_ref 5eb91e68-32e5-47f5-9f10-ee7600352165
                payload.print.providerRef  5eb91e68-…
```

Gelato's own record of it: `orderType: draft`, `shippingAddress.country: CH`,
`city: Wohlenschwil`, one item — a draft because `live` is not set locally,
which is exactly right. Deleted afterwards (`DELETE …/orders/…` → 200).

**The confirmation**: "Ordered. Your book is being printed." with the two
downloads beneath it. `/tmp/b1157-order-panel.png`, `/tmp/b1157-done.png`.

Three things changed after looking, which is what looking is for:

- The price sat *above* the envelope, reading as though the two were
  unrelated. Postage is most of the difference between a cheap book and an
  expensive one, so the total now follows the address it was quoted for.
- The button said "Pay with credits" — naming neither the object nor the
  number, on a press that orders a printed book. It says
  "Order the book — 183 credits".
- The done panel still offered **"Print and post this book →"**, which was the
  original complaint surviving into the new flow and is now simply false: the
  book went to the printer on the press that produced that panel. It reads
  "See this order →".

Not done, and deliberately: the order page is still the old receipt-and-print
panel rather than a status page for a book already at the printer. It works —
it is what a refused order retries from — but the words on it are written for
the flow this ticket replaced. Worth its own pass.

The Hungarian strings are English copies, as B912 records for the locale as a
whole.
