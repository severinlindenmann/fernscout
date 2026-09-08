---
id: B955
title: What a trip has cost is added up by the model and comes out wrong
type: ISSUE
priority: high
complexity: medium
area: helper, model
found: "2026-09-08T11:33:51Z"
started: "2026-09-08T11:46:46Z"
merged: "2026-09-08T11:52:00Z"
---

# B955 — What a trip has cost is added up by the model and comes out wrong

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Four costs logged in one session — £85, £22, £60 and €40. Asked *"what has this
trip cost so far, all together?"*:

> "the total so far is 107 pounds… an average of 53.50 pounds a day."

107 is 85 + 22 exactly: the two costs added *earliest* in the conversation. The
two added in the immediately preceding turns were dropped, and the average was
over two days where the API says `daysWithCosts: 4`.

Then the end-of-session summary contradicted itself inside one sentence:

> "In this session you've logged two costs… 60 pounds… and 40 euros… The trip
> has cost 107 pounds altogether."

£60 + €40 is not £107 under any rate, and the £85 and £22 it had just been
totalling were left out of the list entirely.

**The server already does this arithmetic.** `trip_costs` calls
`getCostSummary`, which returns `total`, `perDay` and `daysWithNothingRecorded`
computed from disk. The entry cache is signature-keyed, so it was not stale.
The model simply answered a money question **without calling the tool**, from
what it could remember of the conversation.

That is the shape B932 already fixed for a different fact: a turn that claims
what a day *says* without having called `read_day` is caught and asked again.
Money is the same kind of claim and has no such check — and it is worse,
because a wrong number reads exactly like a right one and somebody planning
against it has no reason to doubt.

## Work

The honesty net's fourth territory: a turn that states a **total** without
having read the costs. Narrow deliberately — an amount the person themselves
just said, echoed back while proposing to record it, is not a claim about the
trip, so the trigger is totalling language (*altogether, in total, average,
insgesamt, zusammen, összesen*) beside a figure, with no cost read in `looked`.

Not doing: checking the model's arithmetic. It should not be doing arithmetic.

## Acceptance

A turn answering "what has it cost" with a figure and no `trip_costs` call is
caught, asked again, and — twice failed — replaced by a sentence that does not
carry a number.
