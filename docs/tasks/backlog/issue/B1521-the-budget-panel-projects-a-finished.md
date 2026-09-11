---
id: B1521
title: The budget panel projects a finished trip forward and fills unrecorded days with an average
type: ISSUE
priority: high
complexity: medium
area: ui, costs
found: "2026-09-11T20:05:00Z"
---

# B1521 — The budget panel projects a finished trip forward and fills unrecorded days with an average

## Why

Reported by an owner on 2026-09-11, looking at the costs page of a trip that
ended **2025-09-15** — a year ago. Their words: *"Hochgerechnet? wtf… it's like
false information."*

The panel reads:

```
Gegen das Budget                      ↗ CHF 725 bisher über Plan
100% des Budgets verbraucht · CHF 5’725 / CHF 5’000
Geplanter Stand für heute: 100% des Budgets.

Reisebudget 5’000 · Tagesbudget 74 · Hochgerechnet 7’941 · Noch übrig −725
```

Two separate problems, and the second one is the serious one.

### It talks about a finished trip in the present tense

"bisher über Plan", "Geplanter Stand für **heute**", "Noch übrig", and above all
"Hochgerechnet" are all forward-looking. The trip's own `status` is `past` — the
server computes that from `start`. There is nothing left to run and nothing to
project. For a finished trip the honest panel is: what it cost, what it was
meant to cost, and the difference. Three numbers, all in the past tense.

### The projection invents spending on days the owner said were unrecorded

This is the part that makes it false rather than merely odd. Reversing the
arithmetic:

| shown | how it is computed |
| --- | --- |
| Durchschnitt pro Tag **202** | 2 418 ÷ **12** — days that *have* costs |
| Tagesbudget **74** | (5 000 − 3 307) ÷ **23** — *all* days |
| Hochgerechnet **7 941** | 3 307 + 201.5 × **23** |

Three denominators in one panel, and the last one is the damaging combination:
it takes the average of the twelve days that have costs and **charges it to the
eleven days that do not**.

Those eleven days carry `unrecorded: [costs]`. That value exists precisely to
say *nobody wrote this down* — as against `without: [costs]`, which says there
was none. The agent that wrote this journal chose `unrecorded` deliberately,
because cash had been drawn and claiming "no spending" would have been a lie.

The page then charges those days CHF 201.50 each anyway and prints the result
as a headline: **CHF 7 941**, a number 38% above what the trip actually cost,
derived from days the journal explicitly declines to state. `AGENTS.md`'s rule —
*"an empty field beats a plausible fiction"* — is about what an agent writes,
but a renderer that fills the same field with an average breaks it just as
thoroughly, and does it to every journal at once.

## Work

**For a trip whose status is `past`:** drop the projection, the pace bar and the
"für heute" line entirely. Show total, budget, difference. "CHF 725 über Budget"
is the whole story and it is already correct.

**For a trip that is genuinely running,** a projection is useful, but it has to
say what it stands on:

- Project from days that *have* an answer, over days that have an answer — never
  across days marked `unrecorded`. A day nobody costed is not a day that cost
  the average.
- Label it with its own denominator: "hochgerechnet aus 12 erfassten Tagen",
  not a bare franc figure that reads like a measurement.
- If most days are unrecorded, do not show it at all. The number says more about
  the gaps than about the trip.

**Either way, one denominator or an explicit label.** "Durchschnitt pro Tag 202"
and "Tagesbudget 74" sitting side by side invite exactly one reading — that
spending is nearly three times the plan — and that reading is wrong: 202 is per
*costed* day and 74 is per *calendar* day.

Worth checking while in there: `unrecorded` versus `without` should behave
differently everywhere totals are drawn, not just here. This is the first place
anyone has looked since `unrecorded` was added.

## Acceptance

- A past trip's costs page shows no projection, no pace bar and no "für heute".
- A running trip's projection ignores days marked `unrecorded` and names the
  number of days it is built from.
- Any two per-day figures on the page use the same denominator, or each says
  which one it uses.
- A trip whose every day is `unrecorded` shows no projection at all.
