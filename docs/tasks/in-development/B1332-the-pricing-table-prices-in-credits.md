---
id: B1332
title: The pricing table prices in credits a visitor cannot judge
type: FEATURE
priority: high
complexity: medium
area: pricing
found: "2026-09-10T16:23:09Z"
started: "2026-09-10T16:23:31Z"
session: 82456949-2ed4-4811-88ba-62a78eebf6af
claimed: "2026-09-10T16:23:31Z"
---

# B1332 — The pricing table prices in credits a visitor cannot judge

## Why

The public pricing table (`components/Pricing.tsx`, on `/` and `/docs`) prices
every row in credits first, money second. A visitor deciding whether Fernscout
is affordable has to learn a private unit before they can read a price — the
same problem B806 fixed one screen deeper. The owner approved "Entwurf 1
(dezent)" from a reviewed set of drafts (2026-09-10):

- Prices in CHF only; credits appear exactly twice — a highlighted signup-gift
  line at the top of the free card, and a two-sentence note under the price
  list explaining that Fernscout counts internally in credits and what one is
  worth.
- The PDF-only photobook row is removed (owner: not a service we sell — see
  B1331 for the remaining product-side decision). The printed-book row prices
  what a first order actually costs: build + print example.
- The WhatsApp row says what it is (a message to family and friends when a day
  goes online), and that it is not chatting with the agent.
- The writing-helper row says the charge is per finished day, conversation
  included, and that bringing your own agent over the API is free.
- "Printed in Switzerland" becomes "printed locally, near the recipient" —
  Gelato prints in the destination country.

Every figure still comes from the constant that charges it — nothing typed
into a locale string. Display stays CHF (billing currency); showing the
journal's own currency is out of scope.

## Work

- Rework `components/Pricing.tsx` per the approved draft.
- Update the pricing strings in all three locales, `npm run i18n:keys`.
- Not doing: multi-currency display, closing the standalone PDF purchase path
  (B1331), any change to what is charged.

## Acceptance

- `/` and `/docs` show the pricing section with CHF prices, no credits column,
  the highlighted gift line, and the credits note.
- No PDF-only photobook row; the printed row shows "ab CHF 42.40" derived from
  `photobookCredits() + photobookPrintCredits(PHOTOBOOK_QUOTE_EXAMPLE…)`.
- `npm run verify` green.
