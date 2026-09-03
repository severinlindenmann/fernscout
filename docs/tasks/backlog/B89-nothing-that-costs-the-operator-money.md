---
id: B89
title: Nothing that costs the operator money can be paid for, so every paid feature is dry-run only
type: FEATURE
priority: medium
complexity: high
area: credits, billing, postcards, photobook
found: "2026-09-03"
---

# B89 — Nothing that costs the operator money can be paid for, so every paid feature is dry-run only

## Why

Two features here end at a printer and a bill: postcards
(`lib/postcard/providers.ts`, Stannp and Swiss Post) and photobooks
(`lib/photobook/providers.ts`, Peecho, Gelato, Cloudprinter, Lulu). Both build
a complete provider request and stop. `buildRequest` at
`lib/photobook/providers.ts:315` returns a `PreparedRequest`; nothing posts it.
The file header says so plainly: *"Everything here builds a request and stops.
No provider is called."*

That was the right place to stop while there was no way to charge anybody. There
still is no way. `grep -rni "payment\|stripe\|checkout\|invoice" lib app`
returns three hits and none of them is a payment: a comment about basemaps, a
sentence in the demo content, and **a promise in the agent guide**.

The promise is the part worth fixing. `lib/api/documentation.ts:682–685` tells
every agent that reads it:

> Anything that **spends money** — ordering a photobook, sending postcards —
> needs the code *and* a payment the person makes themselves: the server emails
> them a link, and nothing reaches a printer until that is paid.

There is no such link and no such mail. An agent following the guide in good
faith will describe a flow to somebody that does not exist. That is worse than
the feature being absent, because absence is discoverable and this is not.

The third thing that would spend money does not exist yet: B90 wants to send
WhatsApp Business messages, which Meta charges per conversation. Building
payment a third time, per feature, is how three features end up with three
different ideas of what a refund is.

So: one ledger, denominated in credits, that every paid feature draws from.
The person buys a block of credits; a postcard costs some, a photobook costs
more, a WhatsApp message costs one. That is what was asked for, and it is a
different model from the one the guide describes — per-order payment links.
**Both cannot be true.** Prepaid credits is the decision; the guide changes to
match, and that change is part of this task, not a follow-up.

Why prepaid rather than per-order: a payment link per order means an agent that
sends five postcards has sent five payment mails, and the person pays five
times for one act. It also puts a payment flow in the middle of every write
path. A balance is checked and debited in one place, and the buying happens
rarely, deliberately, and out of band.

## Work

This is large enough to want a written design first. Put a plan in
`docs/plans/` and have this task point at it — B06 is the precedent. The plan
has to answer at least these, and the answers are not obvious:

**What a credit is.** A fixed fraction of a currency unit, or an abstract unit
whose price the operator sets? Fernscout is self-hosted, so the operator's
provider costs are their own — a credit cannot be pinned to a number Fernscout
chooses. Likely: the operator sets both the price of a credit and the cost of
each action, in `content/config.json`, with defaults that are honest about
being guesses.

**Where the balance lives.** `lib/db/` — SQLite locally, Postgres in production,
and nothing outside `lib/db/` knows which. Per journal, not per email: an email
may come to own exactly one journal (B92), but the ledger belongs to the thing
that spends.

**A ledger, not a counter.** Every grant and every debit is a row with a reason,
a timestamp and what it paid for. A number that only goes up and down cannot
answer "what did I spend this on", which is the first question anybody asks.

**Debiting exactly once.** A postcard order that fails after the debit must
refund, and a retried order must not charge twice. `lib/mcp/idempotency.ts`
already exists for the same class of problem — read it before inventing
another.

**How credits get bought.** The honest first version may be that they do not:
an operator grants credits with a CLI script, and the purchase flow is a
separate task. Every optional capability here is off by default and must be
*absent* rather than broken when disabled (`lib/capabilities.ts`), so a server
with no payment provider configured should have no credit system at all, not a
balance of zero that nothing can raise.

**What an agent sees.** A refusal for insufficient credits needs to say the
balance, the cost, and what the person does about it — and must not be
confusable with a permission refusal. B91 wants the balance and the price list
in a single status call; that call is a consumer of this, and should be built
after.

**Whether spending still needs `lib/agentConfirm.ts`.** Probably yes: a credit
is money the person already paid, and an agent that can silently spend a
prepaid balance is worse than one that cannot spend at all. The confirmation
stays.

Not doing in this task: connecting any print provider for real, and the
WhatsApp channel (B90). This is the ledger and the accounting, with the
existing dry-run backends as its first consumers.

## Acceptance

- A written plan in `docs/plans/`, referenced from this file, answering the
  questions above before any schema is written.
- A journal has a credit balance and a ledger; both are readable through the
  API by the owner, and every entry says what it was for.
- Ordering a postcard or a photobook checks the balance, refuses with a message
  naming the balance and the cost when it is short, and debits exactly once when
  it succeeds — including on a retry of the same order.
- A failed order leaves the balance where it started.
- With the credits capability off, `/api/health` explains why, no balance
  appears anywhere, and the print features behave exactly as they do today.
- `lib/api/documentation.ts:682–685` no longer describes a payment-link flow
  that does not exist, and describes this one instead.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`, and the
  dev server boots with the capability both on and off.
