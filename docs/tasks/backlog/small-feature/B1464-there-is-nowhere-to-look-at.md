---
id: B1464
title: There is nowhere to look at an order in the states a reader cannot reach
type: FEATURE
priority: high
complexity: medium
area: orders
found: "2026-09-11T14:18:06Z"
---

# B1464 — There is nowhere to look at an order in the states a reader cannot reach

## Why

An order has states nobody can reach on demand: refused-and-refunded, an
unmapped printer word, a proposal that expired, a book whose PDFs were pruned.
B1461 was verified by hand-inserting two rows into a dev database, which is the
procedure this repository already decided against for drawings — `/docs/branding`
exists because "somebody has to look" and a test cannot.

There is no bench for an order, so every future change to one is either
unverified or verified by seeding a database.

## Work

- `components/order/OrderDocket.tsx` and its parts — `StatusStrip`, `Ledger`,
  `Envelope` (absorbing `addressLines` from `components/PhotobookPrintPanel.tsx`),
  `ObjectPlate`, `FileList`, `ActionRow`. Props-only, no product knowledge, no
  data access; it renders an `OrderView` from B1463 and nothing else.
- `/docs/branding/order`: every state side by side, from fixtures in the page —
  no journal, no database, no session, no capability, like the four benches
  beside it. Add the row to `BRANDING_BENCHES` in `lib/docs.ts`.

Visual grammar is the approved draft (option B, "the docket"): object plate
left; status, ledger and files right; one yellow rule on the total; coral
reserved for an actual failure.

## Acceptance

`/docs/branding/order` renders eight states at 1440 and at 390 with no
horizontal scroll and no console error. Still nothing in the product uses the
component — `npm run unused` passes because the bench is its caller.
