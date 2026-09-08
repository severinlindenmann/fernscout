---
id: B960
title: Money in another currency is dropped from the total and nothing says so
type: ISSUE
priority: high
complexity: medium
area: helper, costs, currency
found: "2026-09-08T12:18:38Z"
---

# B960 — Money in another currency is dropped from the total and nothing says so

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

A trip's `rates:` block converts foreign spend into the journal's own currency.
`add_cost` never writes one, so a trip built entirely through the conversation
has `"rates": {}` — and every cost in anything but the base currency is
**silently dropped from the total**.

At volume: six costs in three currencies (RSD 4500, EUR 38 + 60 + 50, CHF 15 +
16). The answer was *"Total for the trip so far: 31 CHF"* — the two CHF ones.
Real spend was north of 200 CHF at any plausible rate. Nothing said anything
had been left out.

`trip_costs`'s return shape has no field for it, so even a model inclined to
mention it has nothing to mention. That is the difference between this and
B959: that one is a wrong number, this one is a wrong number **with no way to
know**.

`getCostSummary` already knows — it is the thing doing the conversion, and it
is the thing that finds it cannot.

## Work

Two halves, and the first is not optional:

1. **Say so.** `getCostSummary` reports what it could not convert; `trip_costs`
   carries that back; the model has a fact instead of a silence. A total that
   admits to being partial is honest. A total that does not is the shape of
   every fault found this week.
2. Then the harder question: where a rate comes from. `site/rates/ecb.json`
   exists and is the shared reference; whether a trip written through the
   conversation should pick one up automatically, and dated to when, is a real
   decision and probably its own ticket.

Not doing: converting at a rate nobody chose. A number invented to avoid an
awkward blank is the thing this codebase refuses everywhere else.

## Acceptance

A trip with costs in two currencies and no `rates:` answers with a total, what
it covers, and what it could not — and the conversation says the second part
out loud.
