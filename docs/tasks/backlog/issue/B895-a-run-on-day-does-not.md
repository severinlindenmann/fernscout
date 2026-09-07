---
id: B895
title: A run-on day does not raise the photobook price, and a test says it must
type: ISSUE
priority: medium
complexity: low
area: photobook pricing
found: "2026-09-07T18:50:51Z"
---

# B895 — A run-on day does not raise the photobook price, and a test says it must

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
