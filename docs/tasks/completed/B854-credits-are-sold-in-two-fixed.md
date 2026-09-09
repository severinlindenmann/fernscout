---
id: B854
title: Credits are sold in two fixed amounts, so nobody can buy the amount they actually want
type: FEATURE
priority: high
complexity: medium
area: credits, payments, account
found: "2026-09-07T17:05:00Z"
started: "2026-09-07T17:08:01Z"
merged: "2026-09-07T17:26:39Z"
completed: "2026-09-09T16:45:09Z"
---

# B854 — Credits are sold in two fixed amounts, so nobody can buy the amount they actually want

## Why

`TIERS` in `lib/credits/pricing.ts` is two rows — 50 for CHF 10.00 and 200 for
CHF 36.00 — and the "Guthaben kaufen" menu on `/<user>/account` offers exactly
those two buttons. Everything else a person might want is unbuyable: somebody
who needs 80 credits for a photobook has to buy 200, and somebody who wants to
try one write-up has to buy fifty.

Two fixed amounts also make the volume discount an announcement rather than an
incentive — 10% appears at one boundary and nowhere else, so there is nothing
to discover by asking for more.

B840 cut three tiers to two because three unit prices at the till was
arithmetic nobody should have to do. That was the right fix for a *list*; the
answer for a range is a slider, where the price and the discount are simply
shown for whatever the person has chosen.

## Work

**One price function, not a list.** In `lib/credits/pricing.ts`:

- `MIN_CREDITS = 10`, `MAX_CREDITS = 500`, `CREDIT_STEP = 10`.
- `BASE_RAPPEN_PER_CREDIT = 20` — CHF 0.20, the price of the first fifty and
  the ceiling on what anybody pays per credit.
- `discountFor(credits)` — nothing up to 50, then `0.20 × ln(n/50) / ln(10)`,
  reaching 20% at 500. Smooth, so every extra credit is cheaper than the last
  and no boundary makes the total jump.
- `priceRappen(credits)` — integer rappen, never a float for money.
- `TIERS` and `tierFor` go. `creditsInRappen` keeps valuing a spend at the
  undiscounted base rate: it is the ceiling on what a credit cost, and the
  postcard preview should not quote a price that assumed a bulk purchase.

**The purchase route takes an amount.** `POST /api/v1/<user>/credits/purchase`
takes `credits` (integer, in range, on the step) instead of `tier`. Refuse
anything else — the price is computed here, never sent by the caller, or the
purchase route is a way to name your own price.

**The slider is `<input type="range">`**, not a component. Native, keyboard
accessible, and it is what a person already knows how to drag. It shows the
amount, the total and the discount as it moves; the Buy button carries the
total.

**Not doing:** a free-text amount box, saved amounts, or a subscription.

## Acceptance

- The account page offers a slider from 10 to 500 and the price follows it.
- `priceRappen` is strictly increasing and the per-credit price strictly
  decreasing across the whole range — a test, not an eyeball.
- `POST …/credits/purchase` with `credits: 137` is refused (off the step), with
  `credits: 700` is refused (out of range), and with `credits: 130` files a
  pending transaction for the price this module computes.
- Nothing in `site/locales/` contains a price.
- `npm run verify` passes.
