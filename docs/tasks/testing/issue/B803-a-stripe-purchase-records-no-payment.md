---
id: B803
title: A Stripe purchase records no payment method, because the branch that would can never be true
type: ISSUE
priority: low
complexity: low
area: credits, payments
found: "2026-09-07T15:20:00Z"
merged: "2026-09-07T15:22:00Z"
---

# B803 — A Stripe purchase records no payment method, because the branch that would can never be true

## Why

`app/api/webhooks/stripe/route.ts` reads the method off
`session.payment_method_types` and takes it only when the list has one entry:

```ts
const method = offered.length === 1 && (offered[0] === "card" || offered[0] === "twint") ? offered[0] : null;
```

`payment_method_types` is what the session **offered**, and
`createCheckoutSession` always offers two. So the list is always length two, the
branch is never true, and `method` is always `null` — dead code that reads like
it does something. Confirmed on the live sandbox purchase
`36eea449-…`: paid by card, `"method": null` on the row.

The cost is small and real: `/admin` and the owner's own transaction list show
the method, and every Stripe purchase will show nothing there.

## Work

Read the method that was actually used, from the payment intent rather than
from the offer: retrieve the session with
`expand: ["payment_intent.payment_method"]` in the webhook and take
`.payment_method.type`. One extra API call on a path that already has to be
idempotent, and it is the authoritative answer rather than an inference.

Keep the check against the two we offer — `"admin"` is a real `PaymentMethod`
and is the operator's own, so a session must never be able to name it. Anything
else stays `null` rather than being invented.

## Acceptance

- A card purchase through the live sandbox leaves `method: "card"` on the row.
- A TWINT purchase leaves `method: "twint"`.
- A retried webhook still grants nothing further.
