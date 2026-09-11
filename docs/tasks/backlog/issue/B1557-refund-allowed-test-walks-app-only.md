---
id: B1557
title: REFUND_ALLOWED test walks app/ only while grant's walks app/ and lib/
type: ISSUE
priority: low
complexity: low
area: test/credits
found: "2026-09-11T23:06:54Z"
---

# B1557 — REFUND_ALLOWED test walks app/ only while grant's walks app/ and lib/

## Why

`test/credits.test.ts:340-358`: the `REFUND_ALLOWED` walk covers
`app/` only, whereas the `grant` walk (lines 303-304) covers `app` and `lib` —
a gap B1363 closed for `grant` and left open for `refund`.
`lib/photobook/print.ts:3` and `lib/helper/transcribeSpend.ts:2` import
`refund` today without the test noticing; both are legitimate, but a future
`lib/` helper refunding a caller-named amount would mint credits with no test
failing.

## Work

Add the `lib` walk to the refund test and put the two existing legitimate
importers on the allowlist.

## Acceptance

`npx vitest run test/credits.test.ts` passes, and adding a stray
`import { refund }` to any `lib/` file fails it.
