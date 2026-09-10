---
id: B1333
title: A print the printer accepts and then refuses is never noticed, so the money stays spent
type: ISSUE
priority: high
complexity: medium
area: photobook, print, credits
found: "2026-09-10T17:10:00Z"
---

# B1333 — A print the printer accepts and then refuses is never noticed, so the money stays spent

## Why

Found by buying a book on the live instance, which is the only way it could
have been found.

`submitBookPrint` answers with a provider reference the moment Gelato accepts
the **create**. Whether the order will actually be printed is decided
separately, seconds later, and nothing looked again. The two sides of one
purchase:

```
ours     print_submitted, providerRef bb5d0b1f…, 203 credits spent
         page: "Bestellt. Dein Fotobuch wird gedruckt."
         receipt mailed, with the PDFs
Gelato   fulfillmentStatus: failed
         financialStatus:   refused
```

So the owner paid 203 credits for a book that will never exist, was told it
was being printed, and got a receipt for it. Every guard built this week —
the refund on refusal (B1157), the refusal page and mail (B1330) — sits behind
a check that had already returned success.

The account has no payment method today, which is why this reproduces every
time. It will stop reproducing the moment a card is added, and the fault will
still be there: any order Gelato fails after accepting is money nobody gives
back.

## Work — done here

Wait for the settlement, briefly. After `recordPrint`, poll
`fetchOrderStatus` for up to 20 seconds; a terminal failure inside that window
is treated exactly like a refusal at the door — refund in full, mark the order
failed, return `refused`, which is what drives B1330's page and mail.

`failed`, `canceled` and `cancelled` are the only statuses that count. Anything
else — `created`, `passed`, `in_production`, `printed`, or a word Gelato adds
next year — is not a failure and must never trigger a refund.

## Work — still open, and the real answer

**This closes the case that reproduces today, not the general one.** An order
that fails an hour later is still nobody's news: the money stays spent and the
page still says it is being printed.

That needs one of:

- **Gelato's order-status webhook**, which is how the printer would tell us.
  A route under `/api/webhooks/`, verified the way the Stripe one is, and the
  same refund path this ticket already wired.
- **A sweep** over `print_submitted` orders that asks Gelato for each and
  settles the ones that ended badly. Cheaper to build, slower to notice, and it
  needs a timer.

Either is a ticket of its own. Twenty seconds of waiting is not a substitute
for it and must not be mistaken for one.

## Acceptance

- An order Gelato fails within the window refunds in full and reaches the
  owner as a refusal, in the page and in the mail.
- `in_production` and other healthy statuses are untouched.
- `npm run verify`.
