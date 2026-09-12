---
id: B1597
title: "v2 tripDoc.costs has no home for costs.md's preparation cost lines or its prose"
type: ISSUE
priority: high
complexity: low
area: API v2
found: 2026-09-12T00:00:00Z
---

## Why

`costs.md` on disk carries three things (see
`content/example/trips/alps-2024/costs.md`):

```yaml
budget:
  total: 900
  days: 4
  currency: CHF
costs:
  - { label: "Vignette and tolls", amount: 90, category: "transport" }
  - { label: "Roof box hire", amount: 60, category: "preparation" }
---
Four days is short enough that the preparation is most of what you decide…
```

The frozen v2 trip schema (`lib/api/v2/schemas/trip.ts:43-54`) models only the
first: `costs: { budget: {total, days?, currency?}, visibility? }`. The
comment beside it says *"Entries on days live on the days"* — which is true of
day spend, and is not true of these. **Preparation costs are spent before the
trip has days**: flights, insurance, visas, a roof box. There is no day to
hang them on, and in v2 as frozen there is no field to send them in.

The prose body of `costs.md` has the same problem: `tripDoc` has `intro` for
`trip.md`'s body and `plan.body` for `plan.md`'s, and nothing for this one.

Found while building the v2 markdown serializer (B1596, phase 2 step 1). Not
a blocker for step 1 — the serializer deliberately scopes to `trip.md` and
`entries/*.md` — but it blocks the trip routes in step 3, and it blocks the
replay of `example` in phase 3, which has preparation costs on both trips.

## Work

Decide, then extend the schema and its tests in the same commit:

- Option A (recommended): widen `costs` to
  `{ budget, items?: costItem[], note?: string, visibility? }`, reusing the
  day's `costItem` shape. One resource, one address, and the
  `category: "preparation"` value already in `COST_CATEGORIES` is what marks
  them.
- Option B: a separate declinable `preparation` section on the trip.

Not doing: moving preparation costs onto a synthetic day. A cost with no day
is the honest shape.

This is a change to the golden contract, so it is the owner's call per
`docs/v2-migration/00-decisions.md` — bring it with the recommended default.

## Acceptance

- `tripCreate`/`tripDoc` accept and echo the whole of `costs.md`, prose
  included, with no field of that file unrepresentable on the wire.
- `test/api-v2-schemas.test.ts` covers the new shape.
- The v2 trip serializer writes `costs.md` byte-losslessly (round-trip test).
