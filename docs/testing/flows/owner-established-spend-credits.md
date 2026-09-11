# Flow: owner-established-spend-credits

**Persona:** `owner-established` (docs/testing/personas/owner-established.md)
**Interface:** journal UI (checkout) + agent (the purchase request only)
**Capabilities exercised:** `credits`
**Device/locale:** run once; the checkout page is Stripe's own hosted page,
not this codebase's UI, so a viewport check only applies to the pages this
repository renders (the balance on `/<user>/me`, the ledger).
**Check type:** technical (Stripe test-mode checkout actually grants credits
via the webhook, and a send actually debits the ledger) and graphical (the
balance shown to the owner before and after).

## Setup

1. Local dev server running with `features.credits` on
   (`OPERATOR_ONLY_FEATURES` — the server's own switch, per `lib/config.ts`'s
   B366 note: "the money lands on the operator's card rather than the
   journal's").
2. `STRIPE_SECRET_KEY=sk_test_…` and `STRIPE_WEBHOOK_SECRET` set to Stripe's
   own test-mode values (Stripe's sandbox needs a free test account, no real
   payment method — `/api/health` prints the mode it read, per AGENTS.md).
3. An owner-scoped agent token and the owner's own cookie session, on a
   `test-owner-established` journal starting at a known credit balance.

## Steps

1. As the agent, `POST /api/v1/test-owner-established/credits/purchase`
   with a `credits` amount in range. Confirm the response is a pending
   transaction and an absolute `paymentUrl` — **no balance change yet**
   (AGENTS.md: "nothing an agent holds can pay, and nothing it holds can
   grant").
2. As the owner, open `paymentUrl`, then `.../payments/<id>/pay`, and
   complete Stripe's hosted test checkout with one of Stripe's published test
   card numbers.
3. `npx tsx scripts/simulate-webhook.ts stripe checkout-completed --base-url
   http://localhost:3013` (or let Stripe's own test-mode webhook fire) against
   `POST /api/webhooks/stripe`. Confirm the balance now reflects the
   purchased credits, granted exactly once (`claimProviderPayment`'s
   once-only claim on the row).
4. Trigger a send that costs credits (e.g. publish a day with
   `whatsapp`/`sms` announcements on, or any billed action this build has
   wired). Confirm the ledger debits the right amount and, with the balance
   too low, the send is refused with `402` and `needed`/`balance` in the
   body rather than silently sent unpaid.

## Done when

- `POST .../credits/purchase` never changes the balance by itself (technical
  check — replay the request and confirm the balance is still unchanged
  before the webhook fires).
- The balance changes by exactly the purchased amount, exactly once, only
  after the signed Stripe webhook lands (technical check — `GRANT_ALLOWED`'s
  own short list in `test/credits.test.ts` names this webhook as one of the
  only three things that may grant).
- A billed action correctly debits the ledger and a balance too small
  refuses the whole action with `402` (technical check).
- The balance shown to the owner (`/<user>/me` or wherever this build shows
  it) matches the ledger before and after, at the requested viewport
  (graphical check).
