---
id: B895
title: A run-on day does not raise the photobook price, and a test says it must
type: ISSUE
priority: medium
complexity: low
area: photobook pricing
found: "2026-09-07T18:50:51Z"
started: "2026-09-08T20:05:00Z"
merged: "2026-09-08T20:16:25Z"
completed: "2026-09-09T16:47:09Z"
---

# B895 — A run-on day does not raise the photobook price, and a test says it must

**STALE — already fixed on `main` before this ticket reached `in-development/`.**
No code was changed. Validated 2026-09-08 in worktree `b895-photobook-price`, on
top of `main` at `7b981aa5`.

Two commits already on `main` resolved the disagreement:

- `9c225e9b` *"A longer day no longer costs more to lay out"* — renamed the
  test from "the page count and the price both follow" to "the page count
  follows, and the build charge deliberately does not", and changed its
  assertion from `toBeGreaterThan` to `toBe`. This is the actual fix: it
  decided the **code** was right and the **test** was wrong, because the
  build charge had already become flat per `bf115f2a` ("Photobook: the PDF is
  a flat charge, printing is quoted where it is going") — the per-page cost
  moved to the print step's own live paper quote (see
  `test/photobook-pricing.test.ts`), which does follow the page count. A
  run-on day costing nothing extra to *build* is the stated point of the
  `runOn` option, not a regression.
- `57b2c1dc` *"A helper that is not a hook, and a price that does not read its
  options"* — dropped the now-unused `options` argument from `priceOf()`
  entirely, since it never affected the number.

`npx vitest run test/photobook-day-plans.test.ts` passes today: 55/55,
including `"the page count follows, and the build charge deliberately does
not"` at what was line 613 (still asserting a relationship between pages and
price — the page count strictly increases and is checked — just not a
relationship the *build* price follows, since that half moved to
`photobook-pricing.test.ts`). `lib/photobook/build.ts:83` confirms
`priceOf()` is `book.volumes.reduce((sum) => sum + photobookCredits(), 0)` —
flat per volume, no page term.

Both fixing commits are ancestors of this branch's HEAD
(`git merge-base --is-ancestor 9c225e9b HEAD` and same for `57b2c1dc` both
succeed), so nothing further to build here.

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`npm run verify` fails on `main` at
`test/photobook-day-plans.test.ts:630` — *"letting a day run on — B517 > the
page count and the price both follow"*. The run-on plan has more interior
pages than the plan without it, and `priceOf` returns the same or less. It
fails on a clean `main` with nothing else in the tree, so it arrived with the
gelato pricing merge (034f0e5f) rather than with any one branch, and it blocks
the gate for every session until it is fixed.

## Work

Decide which is true: the price genuinely no longer follows the page count
now that the PDF is a flat charge and printing is quoted where it is going —
in which case the assertion is what is stale — or the flat charge swallowed a
per-page component it should not have. Fix whichever is wrong.

## Acceptance

`npx vitest run test/photobook-day-plans.test.ts` passes, and the test still
asserts something about the relationship between pages and price rather than
having been deleted.
