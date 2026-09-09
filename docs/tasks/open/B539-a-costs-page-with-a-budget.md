---
id: B539
title: A costs page with a budget and no day-level spending just looks thin
type: FEATURE
priority: low
complexity: low
area: costs page
found: "2026-09-06T10:25:00Z"
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
