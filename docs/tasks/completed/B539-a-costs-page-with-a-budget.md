---
id: B539
title: A costs page with a budget and no day-level spending just looks thin
type: FEATURE
priority: low
complexity: low
area: costs page
found: "2026-09-06T10:25:00Z"
started: "2026-09-11T13:25:07Z"
merged: "2026-09-11T13:48:25Z"
completed: "2026-09-11T19:13:47Z"
---

# B539 — A costs page with a budget and no day-level spending just looks thin

## Why

The third place the import run's gap was visible and unspoken. B531 stops it
at the write; B532 says it on `GET .../costs` and in `GET .../status`. The
owner, though, found it the way owners do — by opening
`/<user>/costs`, seeing a budget and nothing per day, and having to ask
whether something had failed.

Nothing had. But a page that renders a budget, no day rows and no explanation
looks equally like "this trip logged nothing" and "your agent dropped it", and
the reader has no way to tell which.

## Work

For the owner's own view only — a reader does not need to be told what a
journal is missing:

- When the trip has a budget and no day carries costs, say so under the
  budget in one line, with the fact that day costs are written per day.
- `tripGaps` (`lib/api/tripGaps.ts`) already computes it; this is a render,
  not a second calculation.

Not doing: anything on a visitor's view of the page, or a banner. It is not an
error and must not look like one.

## Acceptance

- The owner opening a costs page with a budget and no day costs sees one line
  saying so; a reader who is not the owner sees the page unchanged.
- `npm run verify` green.

## Done

`app/[user]/(trip)/costs/page.tsx` now calls `tripGaps(tripId, true)` — gated
on `canPublish` (the owner signal `readFor(trip)` already returns; no second
owner check added) and on `summary.budget` existing — and derives one boolean,
`noDaySpending`, from exactly the fact `tripGaps` computes at
`lib/api/tripGaps.ts:78`: `gaps.days > 0 && gaps.daysWithCosts === 0`.

That boolean, not `tripGaps`'s own English `note` string, is what reaches
`CostsPageContent`: the note text in `tripGaps.ts` is written for an agent
reading JSON over the API and is English-only, while a line rendered on this
page has to go through the site's own i18n (`AGENTS.md`'s "a new string in the
UI is three files and a script"). So the new `cost.noDaySpending` locale key
(en/de/hu, real translations) is the sentence a reader actually sees, and
`tripGaps` supplies only the yes/no.

`tripGaps` also reports a second, unrelated gap (dates in range with no day at
all) in the same joined `note` — deliberately not surfaced here, since B539
is scoped to "budget and no day-level spending" only; the missing-dates fact
already has its home on the status/import side this ticket does not touch.

Visual check: see the run report below for whether this was driven in a real
browser or left as measurements to take.
