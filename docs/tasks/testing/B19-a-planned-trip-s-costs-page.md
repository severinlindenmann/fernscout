---
id: B19
title: A planned trip's costs page reports spending that has not happened
type: ISSUE
priority: medium
complexity: medium
area: costs, plan
found: "2026-09-01"
started: "2026-09-03T19:24:37Z"
merged: "2026-09-03T19:46:28Z"
---

# B19 — A planned trip's costs page

## Why

`/example/trips/japan-2027/costs` is a trip in April 2027 with two draft
entries and nothing spent on the road. `content/example/trips/japan-2027/costs.md`
is honest about what it is:

> Nothing has been spent on the road yet, so this is preparation and a number
> we have agreed to argue about later.

The page draws it as a trip in progress. Every number in
`getCostSummary` (`lib/costs.ts:150–230`) is computed against `byDay`, which
for an upcoming trip is empty, and the page renders the results without asking
whether the trip has started:

- **A verdict on the pace.** `elapsed = byDay.length = 0`, so
  `expectedToDate` collapses to `preparation` (`lib/costs.ts:195`) and
  `deltaToDate = total - preparation`. The panel reads that and says
  **"exactly on plan so far"**, beside **"18% of the budget used"**
  (`app/[user]/(trip)/costs/CostsPageContent.tsx:273–296`).

  *Corrected while building, 2026-09-03.* This was captured as "over budget,
  in red, with an up arrow", and it does not render that way. The reason is
  that `getPreparationCosts` returns **every** line in `costs.md` whatever its
  category, so `preparation` already includes the flights and the prepaid SIM
  and `deltaToDate` is exactly `onTheRoad` — zero before departure, which is
  `onPace`. Red would need spend on a published day, which an upcoming trip
  does not have. The defect is real and is the same defect: a page saying how
  a trip is going against its budget when the trip has not started. It is
  simply grey rather than red, which makes it quieter and no more true.
- **Projected total, wrong by an order of magnitude.** `daysWithSpend = 0` →
  `actualPerDay = 0` → `projectedTotal = preparation` (`lib/costs.ts:203`).
  A 14 800 CHF budget is "projected" at CHF 2 725.
- **Per day is 0** (`lib/costs.ts:221`), presented beside the total as though
  it were a rate somebody is travelling at.
- **Two empty charts.** `DailyColumns` and `CumulativeArea` are given an empty
  `byDay` (`CostsPageContent.tsx:87` and `:100`) and draw axes with nothing in
  them, under headings that promise a day-by-day breakdown.

None of this is arithmetic that is wrong. It is arithmetic for a question —
"how are we doing against the budget so far" — that has no meaning before
departure, and the page asks it anyway.

`byCountry` is the one section that gets it right: it is hidden when empty
(`CostsPageContent.tsx:69`). That is the pattern the rest should follow.

## Work

The page needs to know whether the trip has started. `lib/tripTime.ts` already
answers the neighbouring questions — `isOver`, `hasHappened` — and
`trip.status` carries `upcoming` as the author's own word for it, the same way
`past` settles `isOver`. Add the "not yet begun" case there rather than
inferring it from `byDay.length` in the component.

Before departure the page should show what is **expected**, not what has been
spent:

1. The budget as a plan — total, per day, how many days it is drawn for — with
   no pace, no delta, no projection, no colour. There is nothing to be over or
   under yet.
2. Preparation costs as themselves. They are real, they have been paid, and
   they are the only true numbers on the page. `costs.md` already separates
   them by category.
3. No day-by-day column chart and no cumulative area. Either omit both, or
   plot the *planned* curve alone — `budget.curve` (`lib/costs.ts:205`) is
   already the planned spend line and is currently only drawn as a reference
   behind actual spend.
4. Say which mode the page is in, in a sentence. A reader should not have to
   work out from a zero whether the trip has started.

Do not special-case this in `CostsPageContent` with a scatter of
`byDay.length > 0` checks — that is how the same bug comes back for the next
zero-valued field. Decide the mode once, at the top.

## What was built

The mode is decided in two places and re-derived nowhere.

**`hasBegun(trip, days, now)` in `lib/tripTime.ts`** — the mirror of `isOver`,
and the answer to the question every "so far" figure assumes. `status` settles
it through `effectiveStatus`, so `current` is honoured as written and
`past`/`upcoming` are the calendar's reading of `start` rather than a field
nobody has edited (B72). `days` is the counterpart of the guard in `isOver`:
a day already written *and already happened* means the trip began early
whatever `start:` says; a day dated ahead is still a plan.

**`hasBegun` on `CostSummary`, and `BudgetStatus.pace`.** `getCostSummary` now
takes an optional `now` — for the reason everything in `lib/tripTime.ts` does —
and asks once. The four pace figures moved out of `BudgetStatus` into a new
`BudgetPace` (`lib/costFormat.ts`), attached only once the trip has begun, so
a page *cannot* draw a delta before departure: the type has nothing to draw.
`total`, `days`, `perDay` and `remaining` are always there — `remaining` is
real before departure too, being the plan minus what preparation cost.

**`CostsPageContent`** branches on `const planned = !summary.hasBegun` and on
`budget.pace`, which is the same decision made in the type. Before departure:
two headline stats instead of four (the two dropped are the rates that are
zero for want of days), a `PlannedBudgetPanel` with no delta, no projection
and no colour — trip budget, daily allowance, days planned, left to spend —
and no day chart and no cumulative area at all, hidden the way `byCountry`
already is. The subtitle says which page this is.

Four locale keys, in `en`, `de` and `hu`: `cost.subtitlePlanned`,
`cost.budgetPlan`, `cost.budgetDays`, `cost.budgetNotePlanned`.

Fixture: `test/fixtures/content/u/trips/gamma-2027/costs.md` gives the
existing upcoming trip a budget and one preparation cost.

Not done, captured instead: **B165** — turning the `costs` capability off
changes nothing on these pages, which is a separate and pre-existing hole
(only `lib/photobook/source.ts` reads the flag). Measured with the capability
off, this page rendered identically before and after this change.

**B139** (the costs page's `generateMetadata` returns English literals) is
untouched and no easier: the metadata for `/[user]/costs` is still four string
literals, and nothing here goes near it.

## Acceptance

- `/example/trips/japan-2027/costs` shows no "over budget", no projection and
  no empty day chart.
- The budget total, the daily allowance and the preparation costs are all
  still shown, and the itemised table is unchanged.
- A trip in progress and a finished trip are byte-for-byte unchanged — cover
  both in the test, since this touches the shared summary.
- `npx vitest run` passes, with a case in `test/costs.test.ts` for a trip that
  has a budget and no elapsed days.
