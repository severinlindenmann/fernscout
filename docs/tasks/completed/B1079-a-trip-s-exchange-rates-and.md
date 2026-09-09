---
id: B1079
title: A trip's exchange rates and planned budget cannot be set from the conversation
type: FEATURE
priority: medium
complexity: medium
area: lib/helper/tools/areas/money.ts
found: "2026-09-09T15:41:58Z"
merged: "2026-09-09T15:42:45Z"
completed: "2026-09-09T16:44:55Z"
---

# B1079 — A trip's exchange rates and planned budget cannot be set from the conversation

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

A trip in a currency with no rate shows a total that silently excludes it —
`getCostSummary` returns those rows as `unconverted` and the page says so, but
nothing in the conversation could set the rate. Same for a planned budget: the
figure exists in `costs.md` and only a form on a page could amend it.

## Work

`set_rate` and `set_budget`. `set_rate`'s card names what is currently outside
the total in that currency, so a person can see what the number is for before
pressing. `set_budget` amends through `patchCosts` and appends a preparation
item rather than replacing the list.

The number is never this software's: it is typed by the person and handed
straight to the writer. Nothing looks a rate up.

## Acceptance

A day with a THB cost and no rate reads `notInTheTotal`. Set the rate through
the room, press, and the same read returns the converted total and an empty
`notInTheTotal`. `test/helper-money.test.ts` is that, end to end.
