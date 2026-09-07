---
id: B684
title: Spoken or typed notes cannot be turned into a day
type: FEATURE
priority: medium
complexity: high
area: agent, credits, capabilities
found: "2026-09-07T09:52:58Z"
---

# B684 — Spoken or typed notes cannot be turned into a day

## Why

Plan §5. This is where the model arrives: the person says or types what
happened and gets prose back to read, correct and keep. Everything before it
(B681, B682, B683) works without it, which is what makes this additive rather
than load-bearing.

It is also the task that has to get the invention rule right, and the rule is
the reason the whole product is trustworthy: **write only what you were told.**
No weather nobody mentioned, no meals nobody ate. An empty field beats a
plausible fiction, and the draft is always shown for review before it lands.

## Work

- A `helper` capability in `lib/capabilities.ts`, **off by default**, requiring
  `ANTHROPIC_API_KEY`, a database and `credits`. Absent rather than broken:
  B681's page stays complete when it is off.
- `lib/helper/` — server-only, model id and prompts in one module,
  `claude-haiku-4-5` through `@anthropic-ai/sdk`, structured output returning
  `{title, prose, warnings[]}`. No streaming, no tools, no loop.
- `POST /api/helper/write-day` — cookie only, bearer refused, the same shape as
  the postcard send route. Idempotent (`lib/idempotency.ts`) so a retry does not
  charge twice.
- Metering: a new spend reason, one credit, the price on the button before the
  tap, and the `warnings[]` rendered as the "left blank" card.
- The one-time consent panel (plan §6): what is sent, what is never sent
  (`gps/`, contacts, addresses), what it costs, revocable from `/<user>/me`.

Not doing: the router (B685), vision (B687), speech (B686).

## Acceptance

With the capability on and consent given, typed notes become a draft the owner
reads before keeping; the ledger shows one credit; a retried request charges
once; with the capability off the button is absent rather than broken. Tests
stub the model and assert the prompt carries the facts it was given.
