---
id: B830
title: The Stripe webhook checks the amount but not the currency, and not that the event's mode matches the key
type: SECURITY
priority: high
complexity: low
area: credits, payments, stripe
found: "2026-09-07T16:05:00Z"
merged: "2026-09-07T16:10:06Z"
completed: "2026-09-09T16:44:50Z"
---

# B830 — The Stripe webhook checks the amount but not the currency, and not that the event's mode matches the key

## Why

Adversarial testing against the live sandbox (with the signing secret, i.e. the
trusted path) found two guards the code reads as if it had but does not:

1. **Currency is never checked.** `claimProviderPayment` compares
   `session.amount_total` against `payment.amountRappen` as a bare integer.
   A signed `checkout.session.completed` with `amount_total: 1000, currency:
   "eur"` (or `usd`) GRANTED the full 50-credit CHF tier — confirmed live.
   The tier is priced in CHF; 1000 of a different minor unit is a different
   amount. `app/api/webhooks/stripe/route.ts` / `lib/payments.ts:claimProviderPayment`.

2. **The event's mode is not checked against the key.** `stripeMode()` reads
   the key prefix, but `whsec_…` encodes no mode. A live key paired with a
   test webhook secret (a plausible deploy slip) passes `stripeEnabled()` and
   every live event fails signature verification — buyers charged, no credits,
   silently, for as long as it takes someone to notice. `event.livemode` is
   available and unread.

Neither is reachable by an attacker without `whsec_`, so this is hardening, not
an open hole — but "the amount matches" is the load-bearing check in the whole
design, and it is currently satisfiable in the wrong currency.

Also found, LOW: the signature timestamp tolerance is one-sided. A past `t` is
refused (good), but a future `t` has no bound — `t = +10 years` was accepted.
Replay is already blocked by the row state machine, so impact is nil, but a
captured future-dated event never expiring is not the intent. This is Stripe's
`constructEvent` default (it only guards against old events); passing an
explicit symmetric tolerance would close it.

## Work

In the webhook, before/inside the claim:
- Refuse unless `session.currency === "chf"` (ignored, logged, 200 so Stripe
  stops).
- Refuse unless `event.livemode === (stripeMode() === "live")`, logged loudly —
  a mode mismatch is a deploy error worth shouting about on the first event.
- Optionally pass a symmetric tolerance to `constructEvent` for the timestamp.

Update `lib/payments.ts` claim doc and `lib/credits.ts:32-46` (which still says
"grant is exported for two callers" — it is three since the webhook).

## Acceptance

- A signed event with the right integer amount but currency eur/usd does NOT
  grant.
- A test-mode event (livemode:false) against a live key does not grant, and
  logs the mismatch.
- Existing chf sandbox flow still grants exactly once. `npm run verify` passes.
