---
id: B866
title: A completed purchase sends no receipt to the buyer
type: FEATURE
priority: medium
complexity: low
area: credits, mail
found: "2026-09-07T17:31:21Z"
merged: "2026-09-07T17:36:50Z"
completed: "2026-09-09T16:44:59Z"
---

# B866 — A completed purchase sends no receipt to the buyer

## Why

A purchase paid through Stripe grants credits and tells nobody
(`app/api/webhooks/stripe/route.ts`). The operator-approval path does send a
line of English hard-coded in the route, with no amount broken out and no
reference a person could put in their own books. Somebody who has just paid
money has nothing in their inbox saying what for.

## Work

One `sendPurchaseReceipt` beside `lib/postcard/receipt.ts`: thank-you,
an invoice table (reference, date, credits, amount, method) and the new
balance, in the owner's language, best-effort. Called from both grant paths;
the ad-hoc mail in the approve route goes.

Not doing: a PDF invoice, and any tax statement — this instance's VAT status
is not in any config it reads.

## Acceptance

Paying a purchase (mock or Stripe) puts a receipt naming the payment id and
the CHF amount in the owner's mailbox; `test/purchase-receipt.test.ts` proves
the amount and reference are in it.
