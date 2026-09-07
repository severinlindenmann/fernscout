---
id: B788
title: When real money arrives, the operator page shows a mock's idea of a transaction
type: FEATURE
priority: medium
complexity: high
area: admin, credits, payments
found: "2026-09-07T16:45:00Z"
---

# B788 — When real money arrives, the operator page shows a mock's idea of a transaction

## Why

B774 put purchases on `/admin`: a queue of what is waiting for the operator to
approve, and what was bought in the window, in francs. Every number in it comes
from the `payments` table, which `lib/payments.ts` describes in its own first
paragraph as *the mock payment ledger*. There is no payment provider. Nobody
has ever been charged.

So the shape is right and the substance is a placeholder, and the placeholder
is load-bearing in ways that will be wrong the day it stops being one:

- **`amount_rappen` is what the tier said, not what anybody paid.** It is
  copied from `TIERS` in `lib/credits/pricing.ts` at checkout. A real charge
  can differ — a currency conversion, a partial capture, a promotion — and the
  page would keep reporting the sticker price as revenue.
- **There are no fees, so takings are gross and read as net.** A card
  processor takes something in the order of 2–3% plus a fixed amount. `/admin`
  has a costs block with four groups and none of them is "the cost of being
  paid", so the one figure an operator most wants — what actually landed in the
  bank — is not derivable from this page at all.
- **There is no state after `paid`.** `PaymentStatus` is
  `pending | requested | paid`. Real money has refunds, chargebacks, disputes
  and failures, and each is a thing an operator must see. A refund is negative
  takings *and* raises the question of credits already spent, which nothing in
  `lib/credits.ts` has an answer for.
- **The approval queue exists only because there is no provider.** B425 built
  it as the interim: a mailed single-use link, because a browser could not be
  trusted to say "this was paid for". A verified server-to-server webhook is
  exactly the thing that *can* say that, at which point the queue stops being
  the operator's inbox and narrows to admin grants alone — which are the only
  thing left that a person genuinely has to decide.
- **`method` is a two-value enum plus `admin`**, and a real provider brings its
  own vocabulary and its own charge id to reconcile against.

**There is no ticket for wiring a provider.** B425 is completed and was the
mock; B89 is superseded. So this one names the consequence rather than waiting
on a dependency that is not captured — and whoever picks up the provider should
read this before designing the schema, not after.

## The part that is a security decision, not a feature

A webhook that grants credits would be **the second HTTP path in the codebase
that raises a balance**, and `GRANT_ALLOWED` in `test/credits.test.ts` would
have to widen to admit it. That list has one entry today
(`app/api/v1/[user]/payments/[id]/approve/route.ts`) and `lib/credits.ts`'s
property 1 — *nothing reachable over HTTP may increase a balance* — is written
around it holding.

Widening it is defensible: a signature-verified webhook from a provider is a
stronger claim than a token in a mailbox. But it is a decision to take
deliberately, with the signature verification, the replay window and the
idempotency key all in place before the allowlist changes — not a line added to
a test to make a build pass. Whoever does it should update that comment in
`lib/credits.ts` and the paragraph in AGENTS.md in the same commit, because
both currently promise something narrower.

## Work

Not designed here — the provider decides most of it. What `/admin` needs once
one exists:

- Takings that are **net**, with fees as their own cost group beside models,
  print and fixed.
- Refunds, chargebacks and failed charges as first-class rows, not absences.
- The provider's own charge id on each row, so the page reconciles against a
  statement rather than against itself.
- The approval queue narrowed to admin grants, and its wording changed — it
  currently says every row was mailed to the operator, which stops being true.
- A payout view, if the provider batches: takings and what reached the bank are
  different questions and an operator asks the second one.

## Acceptance

- No figure on `/admin` labelled as money taken is a price read from `TIERS`.
- A refunded purchase reduces takings and is visible as a refund.
- Whatever grants after a webhook is in `GRANT_ALLOWED` deliberately, with
  signature verification and idempotency, and `lib/credits.ts` and AGENTS.md
  say what the rule now is.
