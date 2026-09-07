---
id: B774
title: Money coming in is invisible on the page about money
type: FEATURE
priority: high
complexity: medium
area: admin, credits
found: "2026-09-07T16:30:00Z"
---

# B774 — Money coming in is invisible on the page about money

## Why

`/admin` (B746, B763) is the operator's page about what the instance costs, and
it shows every franc going out — models, speech, print, sends, the fixed lines.
It shows nothing coming in. `app/admin/page.tsx` does not import
`lib/payments.ts` at all.

Two different things are missing, and the second is the one that matters.

**A completed purchase is technically visible and practically not.** Approval
writes `grant(user, credits, "purchase <id>")`, so it lands in `credit_ledger`
as a row reading `grant +50`, inside the collapsed `<details>` for that
journal, denominated in credits. The `amount_rappen` the person actually paid
is in `payments` and is on no page anywhere. An operator reconciling a card
statement against this page cannot.

**A purchase in flight is invisible full stop.** `payments.status` is
`pending` (a checkout page opened), `requested` (waiting for the operator to
approve) or `paid`. A `requested` row is somebody who has pressed Pay and is
waiting on *the operator personally* — and the only signal it exists is a mail
that may have been read on a phone, archived, or lost. There is no queue
anywhere in the product. B425 built the approval flow and gave it a mailbox as
its only interface.

That is the most actionable thing this page could carry and it is the one thing
it does not.

## Work

- `paymentsAwaiting()` and `paymentsSince()` in `lib/payments.ts`,
  instance-wide rather than per-owner (`listPayments` is scoped to one journal
  and stays that way — it feeds `/[user]/me`).
- A **Waiting for you** section at the top of `/admin`, above the costs, listing
  every `requested` row: journal, credits, price, and how long it has been
  waiting. Empty is the normal state and says so rather than rendering a blank.
- A **Purchases** section: what came in over the window, in francs.
- The hero gains a second figure — taken in against spent — because a page that
  shows one side of a ledger and calls it the total is answering half a
  question.

**The approve button does not move here.** Approval spends a single-use token
mailed to the operator, and `lib/credits.ts`'s property 1 is that no request
raises a balance. This page *shows the queue*; the mail is still what approves,
and the token must never be rendered.

**An admin grant is not revenue.** `createAdminGrant` files a payment with
`amount_rappen: 0` and `method: "admin"` (B746). It belongs in the waiting
queue — it is genuinely awaiting the same approval — and must be excluded from
anything summed as money taken in, or the page reports income that never
existed.

## Acceptance

- A `requested` purchase appears on `/admin` with its journal, credits and
  price, and disappears once approved.
- An admin grant appears in the queue and adds nothing to money taken in.
- No approval token is rendered anywhere on the page.
- The window's takings are francs, read from `amount_rappen`, not credits.
- `npm run verify` passes.
