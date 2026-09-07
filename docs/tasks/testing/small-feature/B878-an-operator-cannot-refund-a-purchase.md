---
id: B878
title: An operator cannot refund a purchase
type: FEATURE
priority: medium
complexity: medium
area: admin, credits
found: "2026-09-07T17:43:36Z"
merged: "2026-09-07T17:52:38Z"
---

# B878 — An operator cannot refund a purchase

## Why

Money can be refunded in the Stripe dashboard and nothing in Fernscout
notices: the `payments` row still reads `paid`, the credits stay in the
balance, and the buyer's account page shows a purchase that no longer
happened. The operator has no way to record it, and the person who was
refunded is told nothing.

## Work

`/admin` gets a Refund button on each paid purchase. It marks the row
`refunded`, takes the purchased credits back down to a floor of zero (never
negative — `spend`'s guard is what a balance below zero would break), records
the deduction in the ledger, and mails the buyer. The account page shows the
transaction as refunded.

Decided with the operator: it never calls Stripe — the money is refunded by
hand there — and it acts immediately rather than through a mailed link, since
a refund lowers a balance and property 1 is about raising one.

## Acceptance

Refunding a 100-credit purchase from `/admin` takes 100 credits (or whatever
is left) off the balance, writes one `purchase_refund` ledger row, flips the
transaction on `/[user]/account` to "Refunded", and puts a mail in the
buyer's inbox. Refunding the same purchase twice does nothing the second
time.
