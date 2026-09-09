---
id: B1155
title: A turn spends a credit and nothing on screen says so
type: FEATURE
priority: medium
complexity: medium
area: components/HelperRoom.tsx, lib/usage.ts, lib/credits.ts
found: "2026-09-09T18:49:32Z"
---

# B1155 — A turn spends a credit and nothing on screen says so

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

A turn spends a credit and nothing on screen says so, until one fails for want
of credit. The balance, what has been spent this month, and buying more all
exist — as API, and as tools the model can be asked for — and none of it has a
face in the room.

## Work

A quiet pill in the header: a waymark lozenge and a number, `navy-600` on
white. Pressing it opens one sheet with the balance, the month's spend, and
buying more. It shares the sheet with B1154's key list.

Three constraints, and the first is not negotiable:

- **"Buy more" must not claim to buy.** Nothing a caller reaches over HTTP
  raises a balance — `lib/credits.ts` property 1, with `GRANT_ALLOWED` in
  `test/credits.test.ts` naming the only three files that may grant. The button
  files a pending transaction and opens Stripe's own page; the balance moves
  when the webhook says so. The sheet says "opens the payment page" and the
  number does not change hopefully.
- **The month figure is units, not money.** `lib/usage.ts` records tokens and
  audio seconds precisely so a period can be re-priced later. Any franc figure
  beside it is a conversion at today's price and should say so.
- **Amber, never red.** Being low on credit is not an error, and red is what
  errors get.

Not doing: a per-turn cost readout. A number that ticks down on every sentence
is a taxi meter, and this is somebody's travel journal.

## Acceptance

The pill shows the balance and turns amber below the threshold. Pressing opens
the sheet. "Buy more" opens a payment page and the balance is unchanged until
the webhook has granted — check the ledger, not the screen.
