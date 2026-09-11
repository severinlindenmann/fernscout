---
id: B1464
title: There is nowhere to look at an order in the states a reader cannot reach
type: FEATURE
priority: high
complexity: medium
area: orders
found: "2026-09-11T14:18:06Z"
started: "2026-09-11T14:38:57Z"
session: 3f748903-2dc3-47a2-a958-98b83d641dc0
claimed: "2026-09-11T14:38:57Z"
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

## Validity

Valid. `/docs/branding` has four benches and none of them is an order; B1461
was verified by inserting two rows into a development database by hand, which
is the procedure this section exists to replace.

## What the bench found, before anything used the component

**Four envelopes is the wrong shape at 390px.** A set of postcards addressed to
a family drew four full envelopes down a phone, pushing the price and the press
off the bottom of the screen. One recipient is now an envelope; several are a
compact list of name and town — which is also what somebody actually checks on a
list of four, rather than each street in turn. Found on the bench at 390px, in
the first ten minutes of it existing, and it would otherwise have shipped inside
B1467.

**A line's amount is preformatted in the adapter now**, beside the total, rather
than the component turning a number into money. `OrderLedgerLine.amount` — a
component that formats money is a component that can format it differently from
the total directly above it. A small change to B1463's shape, made before
anything else consumed it.

**No plate unless something rendered one.** An empty rectangle where a cover
should be reads as a picture that failed to load; a book with no thumbnail is
not a broken book. The slot shows the size-and-cover block until B1469 fills it.

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
