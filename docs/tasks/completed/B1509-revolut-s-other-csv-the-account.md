---
id: B1509
title: Revolut's other CSV — the account statement — is refused as unknown_format
type: FEATURE
priority: medium
complexity: low
area: importers, costs
found: "2026-09-11T18:50:00Z"
started: "2026-09-11T21:16:08Z"
merged: "2026-09-11T21:16:09Z"
---

# B1509 — Revolut's other CSV — the account statement — is refused as unknown_format


## Status — done, deployed, working

Implemented, merged and **live on fernscout.ch** as of 2026-09-11.
`importers/costs/revolut-account.ts`, registered ahead of `revolut` in
`index.ts`, 9 tests in `test/costs-import-revolut-account.test.ts`.

Verified end to end against a real 674-row statement: 58 rows inside a 23-day
trip window, 28 of them outgoing non-transfer payments, `checkCostsImporter`
clean, `/openapi.json` now lists `revolut-account`.

**What is left for a reviewer** is the judgement in the three decisions below —
`Started Date` over `Completed Date`, folding `Fee` into `amount`, dropping
`REVERTED` — not the mechanics. Those change what a trip costs and deserve a
second opinion.

## Why

Hit live on 2026-09-11, importing three weeks of Thailand into a journal.

Revolut exports **two** different CSVs and they share neither shape nor menu
path. `importers/costs/revolut.ts` reads the *consolidated statement*: a
document of sections per account, with balances, crypto gains, and a little
transaction table inside each section. The owner had reached instead for
**Transactions → export**, which gives a flat table of one account:

```
Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
Card Payment,Current,2025-08-28 16:17:04,2025-08-29 03:48:50,Som Tam Kata,-11.40,0.00,CHF,COMPLETED,977.01
```

`POST .../import` answered `400 unknown_format` with *"Known formats: revolut"*.
Which is true and unhelpful: **both files are Revolut statements**, and which
one somebody has depends on which menu they found. The owner's reasonable
reading was that the tool was broken, and the reasonable workaround — convert
it on the laptop — is exactly the thing `importers/costs/` exists to stop.

The file is not exotic. It is the cleaner of the two: one row per payment, an
explicit `Currency` column, no section parsing.

## Work

A second importer, `revolut-account`, beside the existing one rather than
folded into it — the two share no structure and merging them would make both
harder to read.

Three decisions in it change what a trip costs, and each needs to be the
documented one:

- **Date from `Started Date`, not `Completed Date`.** A card payment made at
  23:40 settles the following morning; the settlement date files the last
  dinner of a holiday under the day everybody flew home.
- **Fold `Fee` into `amount`.** `Amount` is what the merchant took, `Fee` is
  what Revolut took on top, in the same currency, and both left the account.
  `Payment` has no fee field and inventing one is worse than reporting what the
  account actually lost. 39 of 674 rows in the file that prompted this carry a
  fee.
- **Drop `State` other than `COMPLETED`.** A `REVERTED` payment is money that
  came back, and it carries no completion date to file it under anyway.

Deliberately **not** marked as a transfer: an `ATM` withdrawal. Cash spent on a
trip reaches a statement exactly once, at the machine; marking it moves a
fortnight of cash spending out of the total. `Transfer`, `Exchange` and `Topup`
are marked, as in the consolidated reader.

No `charged` is emitted, and that is not an omission: this export is one
account with one `Currency` column, so every row is already in the account's
own currency and there is no second number to read a rate from. A trip paid in
baht from a franc account shows its real rate in the *consolidated* statement.
Worth saying out loud somewhere a caller reads, because "import the statement
and you get your exchange rate" is now true of only one of the two formats.

Detection has to be tight: `revolut.ts` accepts a bare `Date,Description,`
line, so the new importer matches the whole header and sits **above** it in
`COSTS_IMPORTERS`.

## State

Implemented and tested in the working tree on 2026-09-11, uncommitted:

- `importers/costs/revolut-account.ts`
- `importers/costs/index.ts` — registered first
- `test/costs-import-revolut-account.test.ts` — 9 tests

`checkCostsImporter` is clean against a real 674-row statement: 58 rows inside
a 23-day trip window, 28 of them outgoing non-transfer payments. The full suite
is green apart from B1508, which is unrelated.

Filed here rather than in `open/` because promoting is the author's call, and
because this wants a person to look at the three decisions above before it
ships — they are judgement, not mechanics.

## Acceptance

- A Revolut account-statement CSV imports without `unknown_format`.
- A consolidated statement still routes to `revolut`, and neither importer
  claims the other's file.
- A payment made late in the evening is dated the day it was made.
- A reverted row does not appear; a fee is inside the amount it belongs to.
- An ATM withdrawal counts as spending; a transfer between own accounts does not.
