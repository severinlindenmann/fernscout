# Flow: owner-established-add-cost-line

**Persona:** `owner-established` (docs/testing/personas/owner-established.md)
**Interface:** agent (`/api/v2`)
**Capabilities exercised:** `costs`
**Device/locale:** run once; the trip's `costs` section has no viewport of its
own until it is read back on the trip's budget page, so run the graphical
half at the requested viewport only for that read-back.
**Check type:** technical (the write and the read-back agree) and graphical
(the budget page rendering the new line).

## Setup

1. Local dev server running with `features.costs` on — `costs: { enabled:
   true }` is the shipped default (AGENTS.md, `lib/config.ts`), and `costs`
   is the one operator-only capability that spends nothing and reaches no
   supplier (`OPERATOR_ONLY_FEATURES`'s own comment in `lib/config.ts`), so
   there is no per-journal opt-in question to check either.
2. An owner-scoped agent token for `test-owner-established`, and an existing
   trip in that journal (reused, per the persona's own file, rather than
   created for this run).

## Steps

1. `GET /api/v2/test-owner-established/trips/<trip>`. Confirm the trip
   document has no `costs` section yet if none has been written — absent, not
   an error, the same courtesy an empty drafts list gives.
2. `PATCH /api/v2/test-owner-established/trips/<trip>` with a `costs` object
   carrying the existing `budget` (if any) plus `items` with one new
   preparation cost line appended (`{"label": …, "amount": …, "category":
   …}`), describing only a cost the persona actually incurred (AGENTS.md:
   "write what you were told" applies to money the same way it applies to
   weather and meals — no invented merchant, no invented amount). **Send the
   whole `costs` object, not only the new line**: the trip route merges a
   `PATCH` by top-level key, so a `costs` object naming only the new item
   would replace the stored budget and every earlier item rather than adding
   to them.
3. `GET` the same trip again. Confirm the new line is there, unchanged, and
   every field already in `costs` (the budget total, the base currency) is
   still present — because step 2 resent them, not because the route merged
   them for you.
4. Open the trip's budget page in a browser as the owner. Confirm the new
   line renders.

## Done when

- A `PATCH` resending the existing `costs` section plus the new line
  succeeds and the read-back matches exactly what was sent, byte for byte on
  the new fields (technical check).
- The budget page shows the new cost line, at the requested viewport
  (graphical check).
- A malformed cost line (missing amount, or a category not in
  `COST_CATEGORIES`) is refused with a `problems` list naming the field,
  and writes nothing (technical check, cross-referenced against the trip
  route's Zod schema in `lib/api/v2/schemas/` and `/api/v2/openapi.json`'s
  generated refusal for this route).
