---
id: B1521
title: The budget panel projects a finished trip forward and fills unrecorded days with an average
type: ISSUE
priority: high
complexity: medium
area: ui, costs
found: "2026-09-11T20:05:00Z"
started: "2026-09-11T20:56:30Z"
session: bfe90fb0-0095-4532-8af8-601ad489b14c
claimed: "2026-09-11T20:56:30Z"
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

## Done

Confirmed the diagnosis against the code before touching anything:
`lib/costs.ts`'s old `getCostSummary` attached `budget.pace` (and therefore
the projection) whenever `hasBegun` was true, with no check for whether the
trip was *over* — `lib/tripTime.ts`'s `isOver` already existed (used by
`TripStory.tsx` and the map page) and was simply never asked here. The
averaging bug was `actualPerDay = onTheRoad / daysWithSpend` (a filter of
`amount > 0`, blind to `unrecorded`) multiplied straight through by
`planned.days` — exactly the ticket's reversed arithmetic.

**Changed:**

- `lib/costFormat.ts` — `BudgetPace.projectedTotal` is now optional, and a new
  `BudgetPace.projectedFromDays` names the denominator. `CostSummary` gained
  `isOver: boolean`.
- `lib/costs.ts` — added a `recordedDays = byDay.length - unrecordedDays`
  denominator (everything but an `unrecorded` day; a `without` day or an
  unflagged real zero both count, which `daysWithSpend` never did). `perDay`
  and the projection's `actualPerDay` both use it now. `pace` is only
  attached when `begun && !over` (`over` from `isOver(trip, byDay, now)`).
  `projectedTotal` itself is only included when at least half the elapsed
  days are recorded (`recordedDays * 2 >= elapsed`); otherwise the pace object
  still carries `expectedToDate`/`deltaToDate`/`projectedFromDays` but no
  franc figure.
- `app/[user]/(trip)/costs/CostsPageContent.tsx` — added `PastBudgetPanel`
  (total/budget/diff only, past-tense copy, no bar tick, no projection),
  wired in ahead of the existing `BudgetPanel`/`PlannedBudgetPanel` branch by
  `summary.isOver`. `BudgetPanel`'s "Hochgerechnet" stat is now conditional on
  `pace.projectedTotal` being defined and labelled with `pace.projectedFromDays`
  via a new `cost.projectedFrom` key, replacing the old bare `cost.projected`
  (removed — no longer referenced anywhere).
- `site/locales/{en,de,hu}.json` — added `cost.overBudgetFinal`,
  `cost.underBudgetFinal`, `cost.budgetNoteFinal`, `cost.projectedFrom`;
  removed `cost.projected`; reworded `cost.perDay` in all three languages to
  name its denominator ("Average per recorded day" / "Durchschnitt pro
  erfasstem Tag" / "Napi átlag a rögzített napokra"), since it sits on the
  same page as the calendar-day "Tagesbudget"/"Napi keret" and the two used to
  invite exactly the wrong reading. Ran `npm run i18n:keys` afterwards.
- Tests: new `test/costs-projection.test.tsx` (5 cases: a finished trip drops
  `pace` regardless of how its days were recorded, and the rendered panel
  says so in past tense with neither "für heute" nor "Hochgerechnet"; a
  running trip's projection uses only recorded days including a real
  `without` zero, and names its denominator; a majority-unrecorded running
  trip shows no `projectedTotal`; an all-unrecorded trip likewise). Updated
  `test/costs.test.ts` (`alpha-2023`, a `status: past` fixture, no longer
  expects a `pace` block — this was the exact bug pattern, "untouched" was
  wrong), `test/currency.test.ts` (the mixed-currency pace test's fixture
  trip had drifted into real-world history since it was written; changed it
  to `status: current` with a later `end` and read it at an explicit
  in-trip `now`, since a bare `getCostSummary("u/thai-2026")` today correctly
  reads as over and would otherwise have no pace to assert against),
  `test/trip-summary-unconverted.test.tsx` (updated the literal label text),
  and the `CostSummary` object literals in `test/costs-tense.test.tsx` /
  `test/costs-title.test.tsx` (added `isOver`).

**Acceptance, checked:**

1. *Past trip: no projection, no pace bar, no "für heute".* —
   `test/costs-projection.test.tsx` → "a trip that is over" (both cases):
   `getCostSummary` returns `budget.pace === undefined` for a `status: past`
   trip regardless of how many days are recorded, and the rendered panel
   contains neither "Hochgerechnet" nor the pace-mark text, and does contain
   the past-tense `cost.overBudgetFinal`/`cost.budgetNoteFinal` strings.
   `test/costs.test.ts` → "a finished trip keeps its plain numbers and drops
   the forecast" (`alpha-2023`, a real fixture, not one built for this
   ticket) confirms the same on existing content.
2. *Running trip's projection ignores `unrecorded` and names its
   denominator.* — `test/costs-projection.test.tsx` → "projects only from the
   days that have an answer, and says how many": 2 recorded days (90 each)
   + 1 real zero (`without`) + 2 `unrecorded` days average to 60/day over 3
   recorded days (not 2, not 5), `projectedFromDays === 3`, and
   `projectedTotal === 1200` (60 × 20 planned days) — the old formula would
   have used `daysWithSpend` (2) and produced 900. The component only shows
   `cost.projectedFrom` (interpolated with the count) when `projectedTotal`
   is defined.
3. *Shared or explicit denominators.* — `cost.perDay` (top headline stat) now
   reads "Average per recorded day" / "Durchschnitt pro erfasstem Tag" /
   "Napi átlag a rögzített napokra" in the three locales, and the projection
   stat is labelled with its own day count — neither sits beside
   "Tagesbudget"/"Daily allowance" any more without saying which days it
   counts.
4. *All-`unrecorded` trip shows no projection.* —
   `test/costs-projection.test.tsx` → "every day unrecorded: no projection at
   all" and "shows no projection at all once most of the elapsed days are
   unrecorded" (majority case, one short of literally every day).

**Verify:** `npm run verify` — build, tsc, eslint, all 540 test files / 7054
tests (4 skipped, Postgres dialect, no local instance), and `npm run unused`
all passed. No failures.

Not touched, deliberately out of scope: `lib/helper/tools/areas/money.ts`'s
`trip_costs` tool returns `costs.budget` unmodified, so it inherits this fix
automatically (a past trip's tool answer will likewise carry no `pace`); its
`describe` string was not touched since it makes no claim about pace or
projection today.
