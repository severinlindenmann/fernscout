---
id: B1268
title: The budget bar is red at half the budget spent, because its colour and its length measure different things
type: ISSUE
priority: medium
complexity: low
area: costs
found: "2026-09-10T10:08:12Z"
started: "2026-09-11T13:25:04Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T13:25:04Z"
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

## Done

`BudgetPanel` in `app/[user]/(trip)/costs/CostsPageContent.tsx` no longer
colours the bar from `pace.deltaToDate` (a per-day-pace fact) at all. The bar
now measures and colours the same thing: its length is still `spent /
budget.total`, and its fill is the site's alarm colour
(`CATEGORY_STYLE.other.color`, `#e34948`) only when `spent > budget.total` —
actually over the whole budget — and the neutral `#5a6a80` otherwise. The
over/under/on-pace sentence above the bar keeps its own colour (green/coral/
navy text) unchanged, since that is the pace verdict in words and losing
nothing by the bar going quiet.

A second mark was added rather than a second colour: a 1px vertical tick at
`pace.expectedToDate / budget.total`, inside the same bar, showing where the
plan says spending should stand today. It carries `aria-hidden` with an
`sr-only` companion sentence (`cost.paceMark`, "Planned position for today:
{percent}% of the budget.") so the fact reaches a screen reader too.
`PlannedBudgetPanel` (pre-departure) is unaffected — it never had a pace to
colour by.

Visual check: see the run report below (this batch's final message) for
whether this was driven in a real browser or left as measurements to take.
