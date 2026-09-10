---
id: B1348
title: Two settlers of one refused print both refund it
type: SECURITY
priority: high
complexity: low
area: photobook, credits
found: "2026-09-10T19:40:00Z"
merged: "2026-09-10T17:28:31Z"
---

# B1348 — Two settlers of one refused print both refund it

## Why

Found by the security review on B1345's commit, and it is real.

`settleRefusedPrint` read the order, checked `status === "print_submitted"`,
and then refunded:

```ts
const current = await getPhotobookOrder(owner, id);
if (!current || current.status !== "print_submitted") return false;
await refund(owner, credits, id);
await markPrintFailed(owner, id, current.payload, status);
```

Between the read and the write there is nothing. Two callers reach the same
order and both see `print_submitted` before either has changed anything, so
both refund — and `refund()` (lib/credits.ts:254) is deliberately
unconditional and does not deduplicate by `ref`, so the second one is money
given away.

**This was not hypothetical the moment B1345 landed.** There are now two
settlers by design — Gelato's webhook and the five-minute sweep — and Gelato
retries a webhook it thinks failed. The comment above the function claimed
idempotency and the ticket claimed it too; the claim was about
`markPrintFailed` moving the row out of `print_submitted`, which is true and
happens *after* the refund.

Reproduced by test before fixing:

```
AssertionError: expected [ true, true ] to have a length of 1 but got 2
```

## Work

- `markPrintFailed` becomes a conditional update gated on
  `status = 'print_submitted'`, returning rows-affected — the same shape as
  `claimForPrint` and `claimOrder`, which this codebase already uses wherever
  money must move once.
- `settleRefusedPrint` claims **before** it refunds, and returns `false`
  without touching the balance when it loses.

**The order is the fix, not just the guard.** Claiming first means a crash
between claim and refund leaves an order marked failed and not yet refunded:
visible, and a person can put it right. Refunding first would leave it
refundable again, and the failure nobody sees is the one that pays twice. That
is `printOrder`'s own reasoning one step earlier.

`markPrintFailed`'s four other callers all hold `claimForPrint` already and are
unaffected; `recordPrint` does not change the status, so the twenty-second
settlement path inside `submitBuiltBook` still finds `print_submitted`.

## Acceptance

- Two concurrent settlements of one order refund once. **Tested**, and the
  test fails against the old ordering.
- A later attempt settles nothing and moves no balance.
- `npm run verify`.
