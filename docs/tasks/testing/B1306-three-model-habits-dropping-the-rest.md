---
id: B1306
title: Three model habits: dropping the rest of a request, asserting absent capabilities, inventing tool prices
type: ISSUE
priority: medium
complexity: low
area: whatsapp, helper, honesty
found: "2026-09-10T11:51:14Z"
merged: "2026-09-10T12:27:10Z"
---

# B1306 — Three model habits: dropping the rest of a request, asserting absent capabilities, inventing tool prices

## Why

scenario-costs.md defect A: "wir haben heute 45 franken für abendessen
ausgegeben" with no day yet led to a `start_day` proposal (reasonable — a
cost needs a day). Pressing it created the day, but the 45 CHF dinner —
the actual reason for the whole exchange — was silently forgotten; the reply
jumped straight to the coordinates ask, and the cost had to be re-stated in
full before `add_cost` was ever proposed. A confirmation press was treated
as though it closed out the whole message rather than only the part it
answered.

scenario-edges.md finding 8: "kannst du postkarten verschicken?" on a
journal with `postcards` switched off answered *"Ja, ich kann Postkarten
vorschlagen"* and started gathering trip/day/message fields for a feature
that cannot actually complete — asserted from the model's own belief, with
no tool called to check. scenario-margrit.md finding 6: `start_day`'s own
proposal claimed *"Das choscht en credit"* for a tool that is not in
`CREDIT_COST_BY_TOOL` and costs nothing — an invented, specific figure about
the product's own pricing.

## Work

Two lines added to `threadSystemPrompt` (`lib/helper/model.ts`), beside the
existing "Long gap, new subject: ask" line — the token-ceiling test in
`test/helper-thread.test.ts` (~8000 tokens) binds tightly, and both fit only
after `lib/helper/tools/areas/money.ts`'s `trip_costs` `describe` (widened
for B1305's own budget field) was trimmed by a few words to make room:

> After a press, answer the rest of what they asked. Never state a price or
> capability from memory — check first.

Both of the ticket's two asks fit, so nothing was dropped to a note. No
retry or code guard added for either — unlike the honesty net's checks
(B920/B944/B1302), neither shape here is checkable against the turn after
the fact: "did the model answer the *rest* of a multi-part message" and "did
it check before asserting" are about what the model chose to *do*, not a
claim the server can verify against a tool result. This is squarely the
"argue it once, in the prompt" case rather than a guard candidate.

## Acceptance

`test/helper-thread.test.ts` ("tells the model to finish the rest of a
message after a press, and never assert a price or capability unchecked")
asserts both lines are present in `threadSystemPrompt`, and the existing
"stay under the ceiling" test still passes.
