---
id: B1336
title: Nothing reconciles a submitted print with what the printer finally did
type: FEATURE
priority: high
complexity: medium
area: photobook, print, credits
found: "2026-09-10T17:55:00Z"
---

# B1336 — Nothing reconciles a submitted print with what the printer finally did

## Why

B1333 made `submitBuiltBook` wait twenty seconds for the printer to settle,
which was a guess. Measured on the live instance:

```
order submitted          fulfillmentStatus: created,  financialStatus: pending
+62s                     fulfillmentStatus: failed,   financialStatus: refused
```

**Sixty-two seconds.** The twenty-second window catches nothing here, and
widening it is not the answer — a person pressing a button cannot be held for
two minutes, and the next refusal could take an hour.

So the order sits in `print_submitted` for ever: the credits stay spent, the
page says the book is being printed, and the receipt has already gone out with
the PDFs. Every guard built for this — the refund (B1157), the refusal page and
mail (B1330) — is downstream of a check that returned success.

## Work

A sweep, run on a timer rather than in a request:

- `listSubmittedPrints()` — every `print_submitted` photobook across all
  journals. Reconciliation is the instance's business, not one owner's.
- `reconcileSubmittedPrints()` asks Gelato for each and settles the terminal
  failures exactly as a refusal at the door is settled: refund in full, mark
  the order failed, mail the owner with no download links.
- `npm run photobook:reconcile` for the timer and for a person.

Three things it must not do, and does not:

- **Refund on silence.** `fetchOrderStatus` returning `null` — no key, no
  network, a reference Gelato has forgotten — is an unanswered question, not a
  refusal. Counted and left alone.
- **Refund on anything but a terminal failure.** `created`, `passed`,
  `in_production`, `printed` and any word added next year are healthy.
- **Refund twice.** `markPrintFailed` moves the row out of `print_submitted`,
  so a settled order is not in the next sweep, and the row is re-read before
  acting in case the in-request check settled it in between.

## Acceptance

- An order the printer refuses after the request has ended is refunded, marked
  failed, and its owner told.
- Running the sweep twice settles nothing the second time.
- `npm run verify`.

## Still open

The timer itself, and a webhook. This ships the mechanism and the command;
putting it on `scripts/backup.sh`'s schedule — or taking Gelato's order-status
webhook instead, which would make it immediate — is the next step and wants
the operator's hand on the server.
