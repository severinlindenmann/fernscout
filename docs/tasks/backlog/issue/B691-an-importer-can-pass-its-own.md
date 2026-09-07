---
id: B691
title: An importer can pass its own contract check and still have the money upside down
type: ISSUE
priority: high
complexity: medium
area: importers, costs
found: "2026-09-07T09:58:57Z"
---

# B691 — An importer can pass its own contract check and still have the money upside down

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`importers/costs/schema.ts` says `amount` is what the merchant charged, in
`currency`, and `charged` is what it came to in the **account's** currency.
That direction is load-bearing: `readStatement` computes an exchange rate as
`charged.amount / amount`, and a day's total in `charged.currency`.

**Nothing checks it, and it is easy to get backwards.** Found by giving a
Haiku subagent the contract, the Revolut importer as an example, and an N26
statement to write a reader for. It assigned the account's amount to `amount`
and the merchant's to `charged` — the exact inverse — and its own file comment
described the rule correctly one line above the code that broke it.

A $60 purchase that cost the account €50 came out as:

```
rates: { EUR: 1.2 }      should be { USD: 0.83 }
day total: 60 USD        should be 50 EUR
```

Wrong currency key, rate upside down, and the day's total is the foreign
amount rather than the money that left the account.

**Everything was green.** 25 tests passed, lint and tsc clean,
`checkCostsImporter` satisfied — because the agent wrote its tests to assert
its own misreading, and the check validates *shape* and not *meaning*. Nothing
in the pipeline would have stopped this reaching a costs page, where a wrong
number looks exactly like a right one.

A rate cannot be sanity-checked on its own: 1.2 and 0.83 are both plausible
numbers for USD/EUR. So the check has to come from somewhere else.

**It does.** A statement is one account, and an account has one currency. Rows
with no `charged` are already in it. So:

> every `charged.currency` in a file must equal the currency of the rows that
> have none.

Revolut passes that (rows without `charged` are CHF; every `charged.currency`
is CHF). The inverted N26 fails it (rows without `charged` are EUR; the
`charged.currency` is USD). It is decisive, needs no knowledge of exchange
rates, and costs one pass over the rows.

## Work

**`checkCostsImporter` gains the account-currency invariant**, worded like its
siblings — what is wrong, and what the usual cause is, which here is having
the two the wrong way round.

**The schema comment gains a worked example with numbers**, because prose
describing a direction is what the agent read correctly and then implemented
backwards. `€50 charged for a $60 purchase → amount: -60, currency: "USD",
charged: { amount: -50, currency: "EUR" }`.

**And the ordering invariant nobody enforces**, found in the same exercise:
`importers/gps/index.ts` says "put a stricter format above a looser one", and
the agent appended its new importer *after* `fixes`, which is the catch-all.
Harmless this time — `fixes` does not claim a `.rec` file — and one loose
`detect` away from a format that silently swallows another's files. A test
asserting the catch-all sorts last is the whole fix.

**Not doing:** validating a rate against any published table. The whole point
of reading the statement is that it knows what the money actually cost.

## Acceptance

- `checkCostsImporter` refuses the inverted N26 importer that prompted this,
  with a message naming the likely cause. A test carries that importer's
  output as a fixture.
- Revolut, and a single-currency statement with no `charged` anywhere, still
  pass.
- A test fails if `fixes` is not last in `GPS_IMPORTERS`.
- `importers/costs/schema.ts` shows the direction with numbers.
- `npm run verify` and `npm run unused` pass.
