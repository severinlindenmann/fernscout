---
id: B963
title: Money it said it could not convert is then offered as a rough figure
type: ISSUE
priority: high
complexity: medium
area: helper, honesty, costs
found: "2026-09-08T12:52:44Z"
started: "2026-09-08T12:58:58Z"
merged: "2026-09-08T13:05:14Z"
completed: "2026-09-09T16:46:42Z"
---

# B963 — Money it said it could not convert is then offered as a rough figure

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Asked for a rough figure, the conversation named the money it could not convert
— correctly — and then offered:

> "about 30 CHF worth if you want a fuller number"

for 15 BAM and 1500 MKD. Unprompted.

**That number is invented.** The trip has no rate for either currency, which is
precisely why they were excluded; 1500 MKD is around 21 CHF and 15 BAM around
7, so the estimate is not even far out — which is what makes it dangerous
rather than obviously wrong. It is the one thing AGENTS.md forbids without
qualification, applied to somebody's money: *an empty field beats a plausible
fiction.*

B960 made the conversation honest about what it left out. This is the model
filling the hole back in from its own belief, one sentence later, because a
blank felt unhelpful.

## Work

The prompt is the obvious lever and B829 says it is a weak one. Something
checkable exists here: the turn already knows which currencies the tool could
not convert (`leftOut` in `lib/helper/model.ts`). An answer that names one of
those currencies **and** puts a base-currency figure beside it is converting
something it was told it could not convert.

Narrow it carefully — *"240 CHF, and 15 BAM besides"* must pass, since that is
the honest answer B960 asks for. The fault is a base-currency figure offered
*as* the value of the unconvertible money, which is a different sentence shape:
the two amounts are the same money.

Consider whether the real answer is upstream: B960's second half is where a
rate comes from, and a trip with rates has nothing to estimate.

## Acceptance

An answer offering a base-currency figure for money the tool said it could not
convert is caught. The honest answer that names both is not.
