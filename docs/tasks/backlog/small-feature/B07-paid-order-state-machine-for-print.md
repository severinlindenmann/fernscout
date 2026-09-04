---
id: B07
title: Paid-order state machine for print providers (W28 gap)
type: FEATURE
priority: low
complexity: medium
area: payments, safety-gates
found: "2026-09-01"
---

# B07 — The paid-order state machine

## Why

`docs/plans/W28-agent-safety-gates.md` shipped its gates — confirmation codes
that work once, are scoped to one slug, and return 409 without one. Its index
row records the remainder honestly: "gates done; the paid-order state machine
is not".

So the fourth acceptance line of that plan — **"no order reaches a provider
without a recorded payment"** — is currently guaranteed by the fact that every
print provider runs in `dry-run` and nothing is ever ordered for real. That is
true and it is not a mechanism.

The stop line in the plan still holds and is not up for renegotiation:
*payment provider integration stops at the link and the state machine; nothing
in this repository takes a card number.*

## Work

The state machine, not the payments: an order record with the states a print
job actually moves through, a recorded payment reference before a provider
request may be sent, and the provider adapters refusing to send without one.
`lib/photobook/providers.ts` and `lib/postcard/providers.ts` are where the
refusal belongs, so it holds for every provider rather than per caller.

## Acceptance

- A provider request without a recorded payment is refused, in a test, for
  both photobook and postcard.
- `dry-run` is unaffected — developing and testing still needs no account.
- Nothing in the repository stores a card number.

Low priority precisely because of the second line: with every provider in
`dry-run` there is no live path to protect yet. Do this before the first real
provider key goes into an environment, not before that.
