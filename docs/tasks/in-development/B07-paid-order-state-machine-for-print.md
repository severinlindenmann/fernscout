---
id: B07
title: Paid-order state machine for print providers (W28 gap)
type: FEATURE
priority: low
complexity: medium
area: payments, safety-gates
found: "2026-09-01"
started: "2026-09-06T14:20:16Z"
session: 6b9bf0a6-5ea8-4f27-bfcd-df5022696053
claimed: "2026-09-06T14:20:16Z"
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

## What was found and built

The state machine and the payment record already existed and are not this
ticket's to invent:

- `print_orders.status` (`draft | submitted | printed | failed`) has been the
  states a print job moves through since `001-initial`, and both
  `lib/postcard/orders.ts` (`claimForSend` / `recordResults`) and
  `lib/photobook/orders.ts` (`claimOrder` / `markPrinted` / `markFailed`)
  already drive it that way. B509 (merged, in `testing/`) is what made the
  photobook side charge only after a book actually builds.
- `spend()` in `lib/credits.ts` already writes a `credit_ledger` row with
  `ref` set to the order id before either send path proceeds
  (`lib/postcard/send.ts` and `app/[user]/photobook/order/route.ts`). That row
  **is** the recorded payment reference; a second table or column recording
  the same fact would have disagreed with it within a month.

So the only real gap was the refusal itself: nothing forced a caller to prove
a payment before a `PreparedRequest` could be built. Fixed by adding
`paymentRef: string` to `BookOrder` (`lib/photobook/providers.ts`) and
`PostcardOrder` (`lib/postcard/providers.ts`), and a guard at the top of every
connectable builder — `buildPeechoRequest`, `buildGelatoRequest`,
`buildCloudprinterRequest`, `buildLuluRequest`, `buildStannpRequest` — that
throws `"…no recorded payment"` on an empty string. The guard lives in each
adapter rather than only in `buildRequest`'s dispatcher, because the builders
are exported and callable directly (existing tests already did). `dry-run`
never reaches any of these functions on either pipeline, so it is unaffected;
two CLI preview scripts (`scripts/photobook.ts`, `scripts/postcard.ts`) that
build-and-write-to-disk-but-never-send now pass a literal
`"PREVIEW_NO_PAYMENT_RECORDED"` placeholder, same idea as their existing
`RECIPIENT_NAME` placeholders.

Tests: `test/photobook.test.ts` — "refuses to build a request without a
recorded payment — B07"; new `test/postcard-providers.test.ts` — "refuses to
build a request without a recorded payment — B07" (this file also adds the
first direct test coverage of `buildStannpRequest`, which had none).

No new table, column or card number anywhere. The `claude-security` scan
pipeline needs the `Workflow` tool, which was not available in this session
(the dispatched security agent reported this and correctly refused to
substitute manual guessing for a scan it could not run) — so this is a manual
review, not the pipeline: the diff adds no route, no DB write, no secret and
no new caller; the only behaviour change is a fail-closed throw when
`paymentRef` is empty, on functions nothing in this repository calls yet.
Nothing found worth a backlog capture in the manual read. B594 captures
re-running the pipeline scan on this diff once `Workflow` is available in a
session — do that before the first real provider key goes into an environment
(B435).
