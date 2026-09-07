---
id: B846
title: A payment method not yet activated on the Stripe account fails the whole checkout, not just that method
type: ISSUE
priority: high
complexity: low
area: payments, stripe
found: "2026-09-07T16:45:00Z"
---

# B846 — A payment method not yet activated on the Stripe account fails the whole checkout, not just that method

## Why

`createCheckoutSession` names `payment_method_types: ["card", "twint"]` (B792,
deliberately, to keep Klarna/Link/etc. off the page). But if a named method is
not *activated* on the account, Stripe refuses to create the session at all —
so an inactive TWINT takes card checkout down with it.

Hit live: a fresh live account has TWINT `pending` review, and every checkout
attempt failed with `StripeInvalidRequestError: The payment method type
provided: twint is invalid. Please ensure the provided type is activated in
your dashboard`. Card would have worked; the buyer got nothing.

## Work

Ask for `["card", "twint"]`; if Stripe rejects with a not-activated error, log
it and retry with `["card"]`. TWINT reappears on its own once the operator
activates it — no code change needed then. Any other Stripe error still throws.

## Acceptance

- On an account where TWINT is not active, the checkout page loads with card
  (and wallets), no TWINT, no failure.
- On an account where TWINT is active, both appear.
- `npm run verify` passes.
