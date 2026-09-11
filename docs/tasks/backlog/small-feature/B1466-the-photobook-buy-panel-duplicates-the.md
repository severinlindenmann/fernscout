---
id: B1466
title: The photobook buy panel duplicates the receipt's envelope, ledger and price lines
type: FEATURE
priority: high
complexity: medium
area: orders
found: "2026-09-11T14:18:09Z"
---

# B1466 — The photobook buy panel duplicates the receipt's envelope, ledger and price lines

## Why

The buy panel in `app/[user]/(trip)/photobook/BookLevelView.tsx:360-430` writes
its own envelope, its own price line and its own balance line — the same three
the receipt page writes differently. A price shown before the press and a price
shown after it disagreeing in wording is how somebody concludes they were
charged something else.

## Work

The order block inside `BookLevelView` renders `OrderDocket` with an `action`
slot (the recipient chooser, the total, `Print it — {total} credits`), leaving
the composer above it untouched. The stale-price check (B595) and the
recipient-chooser behaviour are unchanged — this is markup, not money.

Not doing: the wizard, the spreads, the settings panel. They are composing, and
composing stays where it is.

## Acceptance

Buying a book locally still refuses a stale price and still charges exactly
`quote.totalCredits`; the panel matches the draft at 1440 and 390;
`npx vitest run test/photobook-order.test.ts` green.
