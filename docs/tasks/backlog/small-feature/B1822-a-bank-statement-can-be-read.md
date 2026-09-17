---
id: B1822
title: A bank statement can be read but never filed
type: FEATURE
priority: high
complexity: medium
area: costs, import, statements
found: "2026-09-16T19:34:53Z"
---

# B1822 — A bank statement can be read but never filed

## Why

The costs import reads a statement and previews it, and then stops.
`lib/statements/apply.ts` exists and does the write; **no UI calls it.**
`components/extract/NonPhotoImport.tsx` says so in its own doc comment: the
apply step "needs a trip and a category on every row, which is real editorial
work this ticket does not ask this screen to do."

So a person exports their Revolut CSV, uploads it, sees their transactions
listed back, and nothing happens. The parsers are real
(`importers/costs/revolut.ts`, plus the generic column-mapping fallback in
`importers/costs/mapping.ts`); the gap is the last screen.

Design and the per-type peek/decide table:
`docs/plans/2026-09-16-import-onboarding.md`.

Related: B1571 (a full journal refuses costs and contacts imports though those
kinds write nothing), B1581 (Revolut purchase history requires manual imports).

## Work

Add the decide step. `validateRows` in `lib/statements/apply.ts` wants, per row:
`date`, `label`, `amount`, `currency`, `category`. Date, amount and currency
come straight off the export; **label and category are what the screen must
collect.**

- an editable table of the parsed rows, with a category picker per row and
  bulk-assign by merchant, since a statement repeats the same merchant
- a trip to file them against
- rows tickable to skip
- a currency check
- the write button named after what it does: "File 47 costs to Japan 2025"

Verify whether a cookie-door apply route exists under
`app/api/helper/[user]/statement/apply/`; build it if not, wrapping the same
`validateRows` and `applyCosts` rather than reimplementing either.

Import `COST_CATEGORIES` from its source; never copy the list.

Not doing: new bank parsers. Wise, N26 and CAMT.053 are noted in the plan as
the next candidates and belong in their own ticket.

## Acceptance

- A Revolut CSV can be taken from upload to costs appearing on a trip's days,
  entirely in a browser.
- An unrecognised format still reaches the same decide step through the generic
  column mapping.
- Nothing is written before the final button.
- Verified in a real browser with a real test CSV — a 200 is not proof; the
  costs must be visible on the trip.
- `npm run verify` passes.

## Revised 17 September 2026 — this is a *Bring in* studio flow

Per `docs/plans/2026-09-17-the-studio.md`, the import hub is absorbed into the
studio (B1829). This becomes the *Bring in → A bank statement* flow, wearing
the same skeleton as every other action. The work described above is unchanged.
