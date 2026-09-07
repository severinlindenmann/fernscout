---
id: B811
title: The payment page still renders the TWINT/card chooser under a provider, hidden with a class
type: CHORE
priority: low
complexity: low
area: credits, payments
found: "2026-09-07T15:25:00Z"
---

# B811 — The payment page still renders the TWINT/card chooser under a provider, hidden with a class

## Why

`components/PaymentCheckout.tsx` hides the two method buttons with
`${provider === "stripe" ? "hidden" : ""}` rather than not rendering them. Under
Stripe they are dead controls in the DOM — Stripe's own page is where the method
is chosen — and a Playwright run against fernscout.ch found three buttons in
`main` where the page shows one.

`display: none` keeps them out of the accessibility tree, so this is tidiness
rather than a bug. It is worth doing because the next person reading the
component has to work out that a rendered chooser is never usable, and because
`method` is still posted from a state nothing sets.

## Work

Render the chooser only when `provider === "manual"`, and drop the `method`
state and the body it posts on the Stripe path — the route ignores it there.

## Acceptance

- On an instance with Stripe configured, the payment page has one button.
- On one without, the chooser and the hand-approval flow are unchanged.
