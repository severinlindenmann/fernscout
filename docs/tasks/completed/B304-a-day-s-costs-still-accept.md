---
id: B304
title: A day's costs still accept a zero amount and an unrecognised currency, and drop both silently
type: ISSUE
priority: medium
complexity: low
area: api, costs, validation
found: "2026-09-04T14:41:15Z"
started: "2026-09-04T16:07:51Z"
merged: "2026-09-04T16:21:30Z"
completed: "2026-09-04T20:01:39Z"
---

# B304 — A day's costs still accept a zero amount and an unrecognised currency, and drop both silently

## Why

Found while building B295, whose ticket flagged exactly this failure one field
over and excluded the per-day path from its scope.

B295 built `lib/validate/costs.ts` for the trip budget door and made it refuse
what the parsers would otherwise discard in silence: a zero or missing total, a
zero or negative amount, an unrecognisable currency. The reason is B263's — a
write that is accepted, reports success, and stores nothing lets an agent tell
its owner the money is recorded when it is not.

The per-day costs path did not get that treatment. `checkCosts` in
`lib/validate/entry.ts` — which `POST .../days` and `PATCH .../days/<slug>`
both use — checks the category and does **not** check the currency's shape or
reject a zero or negative amount. So a day written with
`{"label": "Ferry", "amount": 0, "currency": "Euros"}` is accepted, and what
reaches the page is a cost item missing its amount, or its currency, or both,
with nothing said to anybody.

Same failure, same fix, one file over. It is separate only because B295's
ticket drew its scope at the trip budget and B295's agent respected that rather
than widening it unasked.

## Work

Done the other way round from how this was first written: rather than
`checkCosts` (lib/validate/entry.ts) reusing `lib/validate/costs.ts`, the two
non-positive-amount and bad-currency checks moved *into* `checkCosts` itself,
and `lib/validate/costs.ts` was trimmed down to call `checkCosts` and nothing
else for its `costs:` list. Reusing `lib/validate/costs.ts` from `entry.ts`
was not an option — `costs.ts` already imports `checkCosts` and `describe`
from `entry.ts`, so importing the other way would have been a cycle.
Concretely:

- `checkCurrencyCode` (an ISO-4217 shape check) moved from `costs.ts` into
  `entry.ts` and is exported from there; `costs.ts` now imports it instead of
  keeping its own copy, for `budget.currency`.
- `checkCosts` gained the non-positive-amount branch and a
  `checkCurrencyCode` call per item, both carrying the exact wording
  `costs.ts` used to carry for its per-item checks.
- `costs.ts`'s `checkItemCurrencies` and `checkItemAmounts` were deleted —
  `checkCosts` now does that work for both doors, so keeping them would have
  double-reported the same problem.

This is smaller than the ticket's own plan (one file gains logic, one file
only loses it) and gets both `POST/PATCH .../days` and the trip budget door
from the same two checks, in the one function, rather than the reuse relation
running in either direction across a would-be cycle.

**The on-disk risk, checked before tightening anything:** neither route reads
an entry through `validateEntry`/`validateEntryEdit` — `lib/entries.ts` reads
a day's `costs:` straight through `parseCostItems` (lib/costFormat.ts), which
is untouched by this ticket. A day already on disk with a zero amount or an
unrecognised currency renders exactly as it did before: the zero-amount item
is dropped, the bad currency falls back to the trip's base currency, silently
in both cases — this ticket does not change that, only what a *new* write may
put there. `test/edit-day.test.ts` has a test that writes such a file directly
(via `createDraft`, bypassing the route's validator, standing in for a file
from before this ticket or one written by hand) and confirms `GET
.../days/<slug>` still answers 200.

## Acceptance

- `POST .../days` and `PATCH .../days/<slug>` refuse a zero or negative cost
  amount and an unrecognisable currency, naming the field. Covered in
  `test/edit-day.test.ts` ("day costs: the same refusal as the trip budget
  door (B304)") at the route level, and in `test/validate-entry.test.ts` at
  the validator level.
- An entry already on disk carrying either still renders. Covered by the last
  test in that same `edit-day.test.ts` block.
- The messages match the trip-budget door's, since it is the same mistake —
  literally the same function and the same strings now, not just similar
  wording; asserted directly in "the messages match the trip-budget door's".
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` — run
  together as `npm run verify`, which passed: build, typecheck and lint clean,
  169 test files / 2486 tests passed, 3 skipped (the Postgres-only tests,
  skipped here as they are everywhere `POSTGRES_TEST_URL` is unset).
