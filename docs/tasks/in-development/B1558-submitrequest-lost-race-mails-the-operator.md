---
id: B1558
title: submitRequest lost race mails the operator a dead approval link
type: ISSUE
priority: low
complexity: low
area: payments
found: "2026-09-11T23:06:54Z"
started: "2026-09-12T07:22:51Z"
session: 5c987a64-dfc0-4ac9-9b57-3804213ba1b8
claimed: "2026-09-12T07:22:51Z"
---

# B1558 — submitRequest lost race mails the operator a dead approval link

## Why

`lib/payments.ts:326-370`: the UPDATE (`WHERE status='pending'`) never checks
rows-affected. Two concurrent Pay presses on the manual (no-Stripe) path both
pass the `status === "pending"` pre-read and both mint tokens; only one hash
lands. The loser returns `ok: true, alreadyRequested: false` with its own
unstored token, and the pay route mails the operator an approval link that
answers `bad_token`. Fail-closed — no unpaid value, no double grant — but the
operator receives two mails, one dead.

## Work

Check `numUpdatedRows` and return `alreadyRequested: true` on zero, so the
loser sends no mail.

## Acceptance

A test racing two `submitRequest` calls on one pending row: exactly one mints a
stored token, the other reports `alreadyRequested`.
