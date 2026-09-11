---
id: B1336
title: Nothing reconciles a submitted print with what the printer finally did
type: FEATURE
priority: high
complexity: medium
area: photobook, print, credits
found: "2026-09-10T17:55:00Z"
merged: "2026-09-10T16:49:11Z"
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

## The timer — B1336's own "still open", now closed

`deploy/fernscout-reconcile.{service,timer}`, installed by `scripts/deploy.sh`
like the backup pair. **Every five minutes**, because this is the only thing
that returns somebody's money when the printer refuses after the request has
ended, and the measured gap was 62 seconds — a nightly sweep would leave a
person believing all evening that they had bought a book which was never going
to exist.

Cheap at that rate: it reads the orders actually in flight, normally none, and
makes no network call at all when there are none.

`OnFailure=fernscout-alert@%n.service`, the same handler the backup uses. A
sweep that has stopped running is exactly as quiet as one with nothing to do,
and the difference is money.

Enabling it once is the operator's:

```bash
sudo systemctl enable --now fernscout-reconcile.timer
```

## Evidence

Run against the live instance with three orders in flight, all of which Gelato
had refused for want of a payment method:

```
photobook reconcile: 3 in flight, 3 settled as refused, 0 could not be asked
  2227d549… settled as canceled — 203 credits returned to severin
  75f71441… settled as canceled — 203 credits returned to severin
```

Balance 240100 → 301200, and the ledger shows `+20300, +20300, +20500` against
the two `-20300` spends and an older one. Run again immediately: **0 in flight,
0 settled** — settling moves the row out of the set, so nothing is refunded
twice.

The mail it sends, read back from the server's own copy:

> **Entschuldige — die Druckerei hat abgelehnt**
> Das Buch von Algarve 2026 wurde gebaut, aber die Druckerei hat den Auftrag
> nicht angenommen. Es wurde nichts gedruckt und nichts verschickt, und alle
> 203 Credits sind zurück auf deinem Konto.
> Wenn wir dem nachgehen sollen, schreib an agent@fernscout.ch und gib diese
> Referenz an: 75f71441-ac69-4b92-81c2-3dd03bc4d009

No `.pdf` anywhere in it, which is the rule B1330 set.
