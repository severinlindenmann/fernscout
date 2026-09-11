# Flow: owner-established-add-cost-line

**Persona:** `owner-established` (docs/testing/personas/owner-established.md)
**Interface:** agent (`/api/v1`)
**Capabilities exercised:** `costs`
**Device/locale:** run once; `costs.md` has no viewport of its own until it
is read back on the trip's budget page, so run the graphical half at the
requested viewport only for that read-back.
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

1. `GET /api/v1/test-owner-established/trips/<trip>/costs`. Confirm
   `exists: false` if no `costs.md` has been written yet — not an error, the
   same shape an empty drafts list gives.
2. `PATCH /api/v1/test-owner-established/trips/<trip>/costs` with one
   preparation cost line, describing only a cost the persona actually
   incurred (AGENTS.md: "write what you were told" applies to money the same
   way it applies to weather and meals — no invented merchant, no invented
   amount).
3. `GET` the same URL again. Confirm the new line is there, unchanged, and
   every field already on `costs.md` (the budget total, the base currency)
   is still present — a `PATCH` amends, it does not replace.
4. Open the trip's budget page in a browser as the owner. Confirm the new
   line renders.

## Done when

- The `PATCH` with no `budget` in the body succeeds (unlike `PUT`, which
  refuses a request missing it) and the read-back matches exactly what was
  sent, byte for byte on the new fields (technical check).
- The budget page shows the new cost line, at the requested viewport
  (graphical check).
- A malformed cost line (missing amount, or a category not in
  `COST_CATEGORIES`) is refused with a `problems` list naming the field,
  and writes nothing (technical check, cross-referenced against
  `lib/api/openapi.ts`'s own documented refusal for this route).
