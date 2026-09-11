---
id: B1481
title: The buy panel names the book but never shows it, and runs down one column on a 1280px screen
type: FEATURE
priority: high
complexity: medium
area: photobook
found: "2026-09-11T15:56:55Z"
started: "2026-09-11T16:04:06Z"
merged: "2026-09-11T16:09:44Z"
---

# B1481 — The buy panel names the book but never shows it, and runs down one column on a 1280px screen

## Why

The panel that sells the book never shows it. It names the size, the page
count and the spine text, and the cover sits eight hundred pixels further up
the page in the spread carousel — so the last thing before a 238-credit press
is a paragraph, an envelope and a price with no object in it. The order page
the press leads to *does* show the cover now (B1469), which makes the checkout
the one screen in the flow without it.

On a 1280px screen the panel is also a single column about 760px wide, with
the envelope, the price card and the button stacked down it and half the
screen empty beside them. The approved draft (option B, "the docket") puts the
object left and the money and the press right, and that is what the receipt
already does.

B1466 shared the envelope and the ledger card with the receipt and stopped
there — deliberately, and recorded in that ticket, because the panel carries
six conditional messages the docket has no slot for. This is the other half of
that decision, taken now that the shape is proven.

## Work

The order panel becomes the docket's two-column shape at `md` and above:
the cover plate and the envelope left, the price card, the notice and the
press right. One column at 390, in the order object → envelope → price →
press, so the button stays reachable.

The cover is `options.cover` where the owner chose one, checked against disk
the way `photobooks/[id]/page.tsx` checks it (B1469) — and no plate at all
when there is none, never an empty rectangle.

Everything conditional stays exactly where it is in the flow: the unbuyable
reasons, the too-poor link, the stale-price hidden field, the building notice.
This is layout, not behaviour — if the diff changes what `quoteBookFor`
returns or when it is called, it has gone wrong.

## Acceptance

At 1280 the panel is two columns with the cover beside the price; at 390 it is
one column with the press above the fold once the price is on screen. Buying
still refuses a stale price. `npx vitest run test/photobook-order.test.ts`
green.