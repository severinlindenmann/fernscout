---
id: B1466
title: The photobook buy panel duplicates the receipt's envelope, ledger and price lines
type: FEATURE
priority: high
complexity: medium
area: orders
found: "2026-09-11T14:18:09Z"
started: "2026-09-11T15:02:43Z"
merged: "2026-09-11T15:09:33Z"
completed: "2026-09-11T19:13:33Z"
---

# B1466 — The photobook buy panel duplicates the receipt's envelope, ledger and price lines

## Why

The buy panel in `app/[user]/(trip)/photobook/BookLevelView.tsx:360-430` writes
its own envelope, its own price line and its own balance line — the same three
the receipt page writes differently. A price shown before the press and a price
shown after it disagreeing in wording is how somebody concludes they were
charged something else.

## Validity, and a deviation from the plan

Valid — the envelope and the price sentence were written out here and,
differently, on the receipt.

**The plan said this panel would render `OrderDocket` with an action slot. It
does not, and the reason is what the code turned out to be.** The buy panel is
not an order: it is a checkout carrying the spine warning, the six unbuyable
reasons, the too-poor link with its route to buying credits, the stale-price
hidden field and the building notice. None of those has a slot on an order,
and giving the docket four more slots to hold them would make it a wrapper
with a hole for everything rather than a shared element.

What actually drifted was the **envelope** and the **price**, and those are now
one component and one function used by both sides of the press:
`OrderEnvelope` and `OrderLedgerCard` from `components/order/OrderDocket.tsx`,
fed by `photobookLedger` in the new `lib/order/ledger.ts`. The panel keeps its
own structure.

`lib/order/ledger.ts` exists because `lib/order/view.ts` reaches
`lib/postcard/orders.ts`, which is `server-only`, and this panel is a client
component — so the money words had to live somewhere a browser can import.

## Work

The order block inside `BookLevelView` renders `OrderDocket` with an `action`
slot (the recipient chooser, the total, `Print it — {total} credits`), leaving
the composer above it untouched. The stale-price check (B595) and the
recipient-chooser behaviour are unchanged — this is markup, not money.

Not doing: the wizard, the spreads, the settings panel. They are composing, and
composing stays where it is.

## Acceptance

Buying a book locally still refuses a stale price and still charges exactly
`quote.totalCredits`; the panel matches the draft at 1440 and 390;
`npx vitest run test/photobook-order.test.ts` green.
