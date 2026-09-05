---
id: B328
title: A trip with fifteen days of costs and no budget file has no costs page
type: ISSUE
priority: high
complexity: low
area: costs, viewer
found: "2026-09-04T18:41:32Z"
started: "2026-09-04T18:42:19Z"
merged: "2026-09-04T18:56:12Z"
completed: "2026-09-05T08:31:03Z"
---

# B328 — A trip with fifteen days of costs and no budget file has no costs page

## Why

Reported by the owner on 2026-09-04: *"I don't see any budget page even I
enabled it for this trip."*

Verified on the server. `content/viki/trips/asien-2025/` has **no `costs.md`**,
and **all fifteen** of its entries carry a `costs:` block — the agent logged
spend per day through the day-writing call, which has accepted `costs` since
W38 and writes it since B292. So the trip has costs. It has no page.

The cause is B267, and it is my own design error. B267 made the costs page
follow the data — the owner's decision, and the right one — but implemented
"has data" as **`hasCostsData(tripId)` → `readCostsFile(tripId) !== null`**
(`lib/costs.ts:81-83`). That asks whether a **budget file** exists, not
whether the trip has any costs. The two are not the same thing and `lib/costs.ts`
knows it: `getPreparationCosts` reads `costs.md`, and `getCostSummary` also
totals what the *days* carry. One of those two sources decides whether the
page exists; both of them fill it.

So the shape of the bug: an agent that logs spend the documented way, day by
day, produces a trip whose costs page would render a complete summary — and
which cannot be reached, because a file nobody asked for is missing.

It also makes B267's own reasoning read wrong. Its Work item said *"no
`costs.md` means no page and no nav entry, and writing one is what brings
both"*, which is now in both generated documents (B267's `BUDGET_QUESTION`)
and is what an agent is told. That sentence needs to follow the fix.

## Work

- **`hasCostsData(tripId)` becomes "does this trip have any costs at all"**: a
  `costs.md`, or any day carrying a `costs:` block. Read `getCostSummary` and
  `getDayCosts` (or whatever the day-side reader is called) before writing a
  third way to ask.
- **Mind the draft question**, which is the trap here: a day's costs count
  toward this only when that day is visible to the reader asking. An
  unpublished day's spend must not bring a costs page into being for a
  stranger — that would leak the existence of unpublished content, and it is
  the same class as B296, B318 and B322. The owner's own view may of course
  include drafts. Check how `getCostSummary` already handles `ReadOptions`
  before deciding; it may already be right.
- **`journalHasCosts`/`costsAvailable`** (the nav's journal-wide question)
  needs the same widening, or the page exists and the nav still hides it.
- **Correct `BUDGET_QUESTION`** in `lib/api/agentCopy.ts`: writing a
  `costs.md` is one way to bring the page, and logging per-day costs is
  another. Keep it to a clause — B308 is open.
- Tests: a trip with day costs and no `costs.md` has a page and a nav entry; a
  trip with neither has neither; a stranger looking at a trip whose only costs
  are on unpublished days gets no page.

## Acceptance

- `viki/asien-2025` — day costs, no `costs.md` — shows its costs page to its
  owner.
- A trip with nothing costed anywhere still has no page and no nav entry.
- No reader learns from a costs page that unpublished days exist.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
