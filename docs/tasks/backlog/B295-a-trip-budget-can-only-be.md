---
id: B295
title: A trip budget can only be written by hand, so an agent cannot give a trip its costs page
type: FEATURE
priority: high
complexity: medium
area: api, costs
found: "2026-09-04T13:43:56Z"
---

# B295 — A trip budget can only be written by hand, so an agent cannot give a trip its costs page

## Why

Asked for by the owner on 2026-09-04, following B293's decision that the costs
page follows the data: no `costs.md` means no page, a `costs.md` means one. That
rule is only usable if something can write the file, and nothing over the
network can.

`lib/costs.ts` reads `costs.md` and never writes it — `readCostsFile` at line
47 is the only thing that touches the path. There is no route under
`app/api/v1/**` for costs, no MCP tool, and no field on the trip-creation or
day-writing calls that reaches it. The two ways a budget exists today are the
`add-a-trip` skill, which writes files on a local checkout, and editing the
file over SSH.

That is the shape this project treats as a defect rather than a limitation.
AGENTS.md: *"if an agent will not do a thing on the owner's behalf, the thing
cannot be done at all"* — and the costs page is a documented feature of the
software with a capability switch, a renderer and a currency-conversion layer
behind it, reachable by nobody who is not standing at the machine.

It also leaves B293 half-answered. Presence-driven means **deleting the budget
is how an owner turns the page off**, and there is no way to delete it either.

## Work

A costs door for a trip, at `/api/v1/<user>/trips/<trip>/costs`, and the same
operations over MCP — B263 established that fixing one door and forgetting the
other is half a fix.

- **`GET`** — the budget and the preparation costs as stored, so an agent can
  read back what it wrote and tell the owner what is there. Include the trip's
  own frozen rates if the reading paths need them; check `conversionFor` before
  deciding what belongs in the response.
- **`PUT`** — write the whole thing: a `budget` object (`total`, `days`,
  `currency`) and a `costs` list of `{label, amount, category, currency?}`,
  plus the prose body that sits under the frontmatter, which is the owner's
  note about the money and must be writable too.
- **`PATCH`** — change part of it without resending everything, following how
  `editEntry` (B266) splices an existing file textually rather than
  reserialising it. Hand-written formatting, comments and key order must
  survive, because this file is one an owner may well have written themselves.
- **`DELETE`** — remove the budget, which under B293's rule is how the page
  goes away. Say so in the response, since "the page is now gone" is the part
  the owner cares about and the agent otherwise has to infer.

Get the vocabulary from the code, not from this ticket: `COST_CATEGORIES`,
`parseBudget` (`lib/costFormat.ts:149` — total and days both required and
positive) and `parseCostItems` are the validation that already exists, and the
door should refuse exactly what they refuse rather than inventing a second
opinion. A budget whose `total` is zero is currently *silently* dropped by
`parseBudget` returning `undefined`; at a door that must be a refusal with a
sentence, not a write that reads back empty.

The shape on disk, for reference — `content/example/**/costs.md`:

```
---
budget: { total: 14800, days: 43, currency: CHF }
costs:
  - { label: "Rail pass, 21 days", amount: 1180, category: "preparation" }
---
Prose about the money.
```

Authority: the same gate as writing a day — whoever `mayWriteTrip` admits,
trip-scoped tokens included. A budget is trip content, and the people on the
trip are the people who spent the money.

Both generated documents, and `/openapi.json`.

Not in scope: per-day costs, which already work through the day-writing call's
`costs` field; and the presence-driven page itself, which is B267.

## Acceptance

- An agent can create, read, amend and delete a trip's budget over REST and
  over MCP, without touching the filesystem.
- A `costs.md` written by hand keeps its formatting and comments through a
  `PATCH`.
- A refused budget (zero total, unknown category, unknown currency) says what
  was wrong rather than writing a file that reads back empty.
- After `DELETE`, the costs page and its nav entry are gone (with B267) and the
  response says so.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
