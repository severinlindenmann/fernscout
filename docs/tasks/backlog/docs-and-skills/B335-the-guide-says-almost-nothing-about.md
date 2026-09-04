---
id: B335
title: The guide says almost nothing about how a day's money and coordinates should be formed
type: DOCS
priority: medium
complexity: low
area: agent guide
found: "2026-09-04T19:17:31Z"
---

# B335 — The guide says almost nothing about how a day's money and coordinates should be formed

## Why

The validators are strict and the guide is not, so an agent learns the rules by
being refused.

`lib/validate/entry.ts:171-190` refuses half a coordinate, a `lat` outside
-90..90 and a `lng` outside -180..180. `lib/api/documentation.ts:1021` says
`lat`, `lng` | Numbers, not strings.` and nothing else — not that they are a
pair, not the ranges, not which point on a day they should name.

The same for money. `checkCurrencyCode` (lib/validate/entry.ts:57) wants three
letters, `checkCosts` (:246) refuses an amount of zero or less and a category
outside the seven in `lib/costFormat.ts:9`. The guide's one row at :1023 names
none of them, and `dayQuestions()` (lib/api/agentCopy.ts:421) — the script an
agent reads before writing a day — never asks about the day's spending at all,
so the field is usually simply missed. Nothing anywhere says the currency is
the one the money was actually spent in, or that a currency the trip's `rates:`
block does not carry is reported unconverted rather than counted wrong.

## Work

`lib/api/agentCopy.ts` and `lib/api/documentation.ts` only — no behaviour
change, no new validation.

- A `DAY_MONEY_QUESTION` and a `dayQuestions()` entry for `costs`.
- Coordinate and cost mechanics in the day field table: the pair rule, the
  ranges, the category list, amount > 0, currency as spent.

Not doing: changing what is validated, and not restating any of it in
`add-a-day` — the skill points at the guide already.

## Acceptance

`curl -s localhost:3000/agent.md` names the seven cost categories, both
coordinate ranges and the pair rule; `npm run verify` green.
