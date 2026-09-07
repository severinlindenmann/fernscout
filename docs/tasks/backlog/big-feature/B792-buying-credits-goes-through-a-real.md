---
id: B792
title: Buying credits goes through a real payment provider, not an operator approving by hand
type: FEATURE
priority: high
complexity: high
area: credits, payments
found: "2026-09-07T14:45:13Z"
---

# B792 — Buying credits goes through a real payment provider, not an operator approving by hand

## Why

Nobody can buy credits. `POST /api/v1/<user>/payments/<id>/pay` files a request
and mails the operator a single-use approval link (B425); the operator opens it,
presses a button, and `.../approve` grants. That is a person watching a mailbox
for money that arrived somewhere else, and it does not scale past the three
journals on this instance.

Everything upstream of Pay is already right and stays: the tier table in
`lib/credits/pricing.ts`, `createPayment`, the checkout page at
`/<user>/payment/<id>`. What is missing is the middle — a provider that takes
the money and tells this server, verifiably, that it did.

Swiss buyers pay by TWINT, Apple Pay or a card, in that order of likelihood.

## Work

Stripe Checkout, hosted. The provider is optional and absent by default: with no
`STRIPE_SECRET_KEY` the existing operator-approval path runs exactly as it does
today, so local dev and any other instance keep working with no Stripe account.

- **No Stripe Products or Prices.** Inline `price_data` from the tier, so
  `lib/credits/pricing.ts` stays the one place a price is written down.
- **No hardcoded payment methods.** `automatic_payment_methods` on the session;
  card (and therefore Apple Pay / Google Pay) and TWINT are dashboard toggles.
  TWINT is CHF-only, CH customers, max CHF 5000 — our top tier is CHF 32.
- **The key is the sandbox switch.** `sk_test_` vs `sk_live_`, no config flag —
  two switches that can disagree is how an instance takes real money in test
  mode. `/api/health` reports which, read from the prefix.
- `.../pay` creates a Checkout Session (`metadata` carries owner and payment id),
  moves the row to `requested`, returns `{ url }`; the component redirects. No
  operator mail on this path.
- **`POST /api/webhooks/stripe`** — new, outside `/api/v1` because it carries
  Stripe's signature and not a session or a bearer token. Raw body,
  `constructEvent`. On `checkout.session.completed` + `payment_status: paid`,
  re-check `amount_total` and currency against the row, then one conditional
  `UPDATE ... WHERE granted = 0 AND status = 'requested'` (the shape
  `claimApproval` already uses) and `grant()` only if that claimed a row. Stripe
  retries; the claim is what makes a retry free.
- `GRANT_ALLOWED` in `test/credits.test.ts` gains this one file. It is the only
  new HTTP path that can raise a balance, and it earns it the same way the
  approve route does: a credential this server verified, and a once-only claim.
- One dependency, `stripe`, for webhook signature verification — replay window,
  key rotation, multiple signatures. Not worth hand-rolling on the money path.

Not doing: subscriptions, refunds from the UI, saved cards, Stripe-side
reporting, a `provider_ref` column (the session id goes in the ledger note).
The `/admin` zero-franc grant and its approve-by-mail link are unchanged.

## Acceptance

- With no `STRIPE_SECRET_KEY`, pressing Pay still mails the operator and the
  approve link still grants. Nothing regressed.
- With sandbox keys set: Pay redirects to Stripe, a test card completes, the
  webhook lands, the balance rises by the tier's credits exactly once, and the
  ledger row names the session.
- Replaying the same webhook event grants nothing further.
- A webhook with a bad signature is a 400 and grants nothing.
- A session whose `amount_total` does not match the row grants nothing.
- `/api/health` says `stripe: test`.
- `npm run verify` passes, including the widened `GRANT_ALLOWED` allowlist.
