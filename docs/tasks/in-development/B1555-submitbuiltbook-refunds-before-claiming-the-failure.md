---
id: B1555
title: submitBuiltBook refunds before claiming the failure — double refund race with the Gelato webhook
type: SECURITY
priority: medium
complexity: low
area: photobook/credits
found: "2026-09-11T23:06:54Z"
started: "2026-09-12T07:22:49Z"
session: 5c987a64-dfc0-4ac9-9b57-3804213ba1b8
claimed: "2026-09-12T07:22:49Z"
---

# B1555 — submitBuiltBook refunds before claiming the failure — double refund race with the Gelato webhook

## Why

`lib/photobook/print.ts:156-160`: when the in-request settlement poll sees a
refused print, it calls `refund(owner, order.payload.credits, id)` *before*
`markPrintFailed`, and discards `markPrintFailed`'s boolean. B1348 fixed this
exact shape in `lib/photobook/reconcile.ts:84-86` (`settleRefusedPrint`),
whose comment says claim before refunding, never after — `refund()` is
unconditional and does not deduplicate by ref. `print.ts` kept the old
ordering, at :156-160 and (a smaller window) :111-117. If Gelato refuses within
the 20-second poll window while its webhook delivers the same failure, both
paths refund: the owner is credited the full book price twice — free credits
spendable at a real printer. Not attacker-triggerable at will (needs a real
provider refusal), but silent when it fires.

## Work

Reorder to claim-then-refund: gate `refund` on `markPrintFailed`'s
rows-affected result, matching `settleRefusedPrint`. Same for the submit-error
path at :111-117.

## Acceptance

A test driving `submitBuiltBook`'s failure path concurrently with
`settleRefusedPrint` for the same providerRef leaves exactly one refund in the
ledger.
