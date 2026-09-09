---
id: B827
title: The imprint's data-residency claim does not mention Stripe
type: DOCS
priority: high
complexity: low
area: legal, payments
found: "2026-09-07T15:52:00Z"
started: "2026-09-08T05:03:44Z"
merged: "2026-09-08T05:03:45Z"
completed: "2026-09-09T16:47:51Z"
---

# B827 — The imprint's data-residency claim does not mention Stripe

## Why

`site/legal/*.md` says everything is on one Hetzner server in Germany, "nothing
is replicated to another country", "no third-party database". Since B792, a
credit purchase sends the amount and the buyer's email to Stripe, and card /
TWINT details are entered on Stripe's own systems, which may be outside Europe.
The claim is now false for the one flow that touches money.

The redirect design is what keeps the *rest* of the imprint true: the "nothing
on these pages is loaded from anybody else's server" line still holds, because
checkout happens on Stripe's domain rather than embedded — which is the reason
B826 branded the hosted page instead of embedding it.

## Work

A carve-out paragraph in the "Where the data is" / "Wo die Daten liegen"
section of both `en.md` and `de.md`: paying is the one exception, only if you do
it, the payment goes to Stripe on Stripe's own systems possibly outside Europe,
amount + receipt email are shared and nothing else, and if you never buy
credits Stripe is never involved. Link to stripe.com/privacy.

## Acceptance

- Both imprints name Stripe and where payment data goes.
- `test/legal.test.ts` and `test/depersonalised.test.ts` still pass.

## Outcome

Already shipped in `f24a8086` — both `site/legal/en.md` and `site/legal/de.md`
carry the carve-out paragraph, name Stripe, say where payment data goes, say
the amount and receipt email are all that is shared, say Stripe is never
involved if you never buy credits, and link to stripe.com/privacy. Only the
lane move was missed; nothing further was needed.
