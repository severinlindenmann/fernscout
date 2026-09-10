---
id: B1268
title: The budget bar is red at half the budget spent, because its colour and its length measure different things
type: ISSUE
priority: medium
complexity: low
area: costs
found: "2026-09-10T10:08:12Z"
---

# B1268 — The budget bar is red at half the budget spent, because its colour and its length measure different things
## Why

On `/example/costs`, the "Against the budget" panel shows, in this order:

> ↗ **CHF 480 over plan so far** *(coral)*
> ▰▰▰▰▰▰▰▱▱▱▱▱▱▱ *(a coral bar, half filled)*
> 50% of the budget used · CHF 12'988 / CHF 26'000
> … **Left to spend CHF 13'012**

The bar's **length** measures one thing — the share of the total budget spent.
Its **colour** measures another — whether spending is ahead of the planned pace.
So a trip that is exactly halfway through its money, with thirteen thousand
francs left, is drawn in the colour the rest of this site uses for a problem.

A bar is read as one measurement. Filled-and-red is the universal shape of
"you have overspent", and this one means "you are halfway, and slightly ahead of
schedule". The number that would correct it — *Left to spend* — is four tiles
further down, and the sentence that would correct it is under the bar in grey.

CHF 480 on CHF 12'988 is under 4%. That is a nudge, drawn as an alarm.

## Work

- Decide what the bar measures and let its colour measure the same thing. A
  second mark on the bar — where the plan says you should be — states the pace
  without recolouring the whole thing, and is the usual answer for exactly this.
- If the colour is kept as a pace signal, it needs a threshold that means
  something; a few per cent ahead is not a red condition.
- Check the panel with a genuinely overspent trip too, so the real alarm is
  still distinguishable from this one.

## Acceptance

- A trip at 50% of budget and marginally ahead of plan is not drawn in the
  colour used for failure elsewhere on the site.
- A trip that has spent more than its budget is unmistakable.
