---
id: B987
title: Credits cannot express a fraction, so a six-second question costs the same as a five-minute one
type: FEATURE
priority: high
complexity: high
area: credits
found: "2026-09-08T16:34:20Z"
started: "2026-09-08T16:45:32Z"
session: 6c81e17b-6acf-4c0f-86ef-49124c9b2458
claimed: "2026-09-08T16:45:32Z"
---

# B987 — Credits cannot express a fraction, so a six-second question costs the same as a five-minute one

## Why

`spend()` refuses a fractional amount outright — `credits: refusing a
fractional spend of 0.02` — and it is right to, because `credits.balance` is an
integer column and the debit is one conditional `UPDATE`. So the smallest
thing this product can charge for is one whole credit, and that is the price of
a six-second question as much as of a five-minute dictation
(`creditsForSeconds` rounds *up* from a 300-second block).

That is not a fair price and it is the wrong shape besides: speech is metered
by the second at the provider (Deepgram, $0.0043/min) and billed here in
lumps 70× larger than the smallest sensible unit.

The owner asked for hundredths — "we should be able to bill 0.01 credits".

## Work

**The stored unit becomes 1/100 of a credit, and stays an integer.** No
decimal column, no floats: money in minor units is the one arrangement that
cannot drift, and every property `lib/credits.ts` is arranged around
(a conditional `UPDATE`, a balance that cannot go below zero under
concurrency, the three-caller `grant` allowlist) survives unchanged because
the column type does not move.

- A migration multiplies `credits.balance` and every `credit_ledger.delta` by
  100, in one transaction, on an instance whose Stripe key is live.
- Every price constant ×100, in one place each: the postcard, the photobook,
  the storage block, the signup grant, the statement read, the day write.
- Everything that *shows* a balance divides by 100 and says two decimals:
  `/[user]/me`, `/[user]/account`, `/admin`, the postcard preview, the
  purchase flow, and the mails that quote a balance.
- Stripe: a purchase's credit count is what the *person* buys, in whole
  credits, and what the webhook grants becomes that ×100. The money side does
  not change at all.
- `creditsForSeconds` becomes per-second with a floor, so a six-second
  question costs a hundredth and a five-minute one costs the same as it does
  today.

**What must not change:** nothing a caller can reach over HTTP may raise a
balance, `spend` stays one conditional statement, and `test/credits.test.ts`'s
`GRANT_ALLOWED` list stays exactly three files.

## Acceptance

- `test/credits.test.ts` still passes with its allowlist untouched, plus a new
  case: a spend of 1 (one hundredth) succeeds and a balance of 1 refuses a
  spend of 2.
- The migration, run against a copy of the live database, leaves every
  journal with exactly a hundred times what it had.
- `/admin` and `/[user]/me` show the same numbers to a person as before.
- A six-second recording costs 0.01 credits; a five-minute one costs 1.00.
