---
id: B1532
title: A card Stannp cancels after acceptance is never refunded
type: ISSUE
priority: low
complexity: medium
area: postcards
found: "2026-09-11T20:22:23Z"
---

# B1532 — A card Stannp cancels after acceptance is never refunded

## Why

Found building B1484's Stannp inbound webhook (`app/api/webhooks/stannp/route.ts`).
Stannp's `mailpiece_status` event can report `cancelled` on a mailpiece
after it was already accepted and counted as sent — the same 62-second gap
`app/api/webhooks/gelato/route.ts` closes for photobook orders, whose own
`settleRefusedPrint` refunds the credit and tells the owner. Postcards have
no equivalent: `recordResults` in `lib/postcard/orders.ts` marks an order
`built`/`failed` once, at send, and nothing in this codebase revisits that
afterward. B1484's webhook route stores the cancellation on the matching
`RecipientResult.providerStatus` (additive, does not touch `ok`/the order's
`built` status), but nobody is refunded and nobody is told — the credit for
a card that will never reach anyone stays spent.

## Work

Give postcards the same shape photobook already has: on
`providerStatus === "cancelled"`, refund the one card's `creditsEach`
(`lib/credits.ts`'s `grant`, not `spend` — this is money coming back) and
mail the owner, once per cancellation (a de-dup key the same way Gelato's
`shipped` mail is only ever sent once matters here too). Decide whether this
belongs in the webhook route itself or a small `lib/postcard/reconcile.ts`
the route calls into, mirroring `lib/photobook/reconcile.ts`'s split.

Not doing: delivery tracking (`local_delivery`, `delivered`, `returned`) —
`app/api/v1/[user]/postcards/[id]/route.ts`'s own module comment is explicit
that this system will never know that, and refunding on `cancelled` does not
require knowing it.

## Acceptance

A postcard order whose only card is cancelled by Stannp after acceptance is
refunded exactly once, the owner is mailed once, and a second delivery of
the same cancellation event changes nothing further (idempotent, the same
guarantee `test/photobook-webhook.test.ts` already checks for Gelato).
