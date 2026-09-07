---
id: B840
title: There is no way to find out what this costs before signing up
type: FEATURE
priority: high
complexity: medium
area: pricing, landing, docs
found: "2026-09-07T16:19:12Z"
started: "2026-09-07T16:19:43Z"
merged: "2026-09-07T17:00:33Z"
---

# B840 — There is no way to find out what this costs before signing up

## Why

Nothing on `/` or `/docs` says what anything costs. The prices exist —
`lib/credits/pricing.ts` and `lib/helper/credits.ts` carry them — but the first
place a person meets one is the "Buy credits" overlay on their own `/<user>/me`
page, which is behind signing up. Somebody deciding whether to use this has to
sign up to find out whether it is free.

Two things came out of pricing the units against the real cost basis in
`site/config.json`'s `costs` block while writing this:

**Email to readers is charged at ~1000× cost.** `dayLetter.ts:539` spends one
credit — CHF 0.20 — per delivered email, against roughly 0.01 Rappen of real
cost. Publishing one day to a family of twenty costs CHF 4, which is the most
ordinary thing anybody does here priced like a printed object, and it makes the
ten-credit signup grant worth half of one day's announcement. Every recipient
was approved by hand by the owner (`approveContact` is the only thing that
creates a grant), so there is no fan-out to defend against and no reason to
meter it.

**Two print prices are too thin, and one is too complex.** A postcard at 15
credits is CHF 3.00 against ~CHF 2 landed — one spoiled card wipes out two
sales. `PHOTOBOOK_BASE_CREDITS = 90` puts a 52-page book at CHF 38.80 against
an estimated ~CHF 25 landed. Gelato publishes no per-page rate; what they do
publish is "from $11.85" for a softcover with the first 30 inner pages
included, which is the smallest format — ours is 210 × 210. And three credit
tiers with two different discounts is arithmetic at the till.

Journals: `MAX_JOURNALS_PER_EMAIL = 3` promises something nothing supports —
there is no way to own or buy a second journal today.

## Work

Prices, in `lib/credits/pricing.ts` unless said otherwise:

- `MAX_JOURNALS_PER_EMAIL` 3 → 1 (`lib/journals.ts`)
- `POSTCARD_CREDITS` 15 → 20 (CHF 4.00; ~50% margin on ~CHF 2 landed)
- `PHOTOBOOK_BASE_CREDITS` 90 → 160, per-page stays 2 — a 52-page square book
  becomes CHF 52.80 against ~CHF 25 estimated landed. `PHOTOBOOK_PRICING_VERIFIED`
  stays `false`, and now the table says "estimate" too, so the two agree.
- `TIERS` → two rows: 50 for CHF 10.00, 200 for CHF 36.00 (10% off). The 20%
  tier gave away the most margin to the people who buy most, and the third row
  is the complexity. 50 for CHF 10 stays exactly `EXTRA_STORAGE_CREDITS`.
- Remove the `day_mail` and `digest` spend in `lib/digest/dayLetter.ts`. The
  `SpendReason` values stay so old ledger rows keep reading.

The table itself:

- `components/Pricing.tsx`, one component, rendered on `/` (signed-out) and on
  `/docs`. No new route and no `DOCS_PAGES` entry — a third door to one table.
- Gated on `isEnabled("credits")`. A self-hosted instance with credits off
  charges nothing, and "20 credits per postcard" would be false there.
- Every price rendered from the constants, never typed into a string. Prices in
  two places disagree within a month, and this is the file that would.
- de/en written; hu marked for a person to check.

Not doing: a subscription, a second journal to sell, or a real Gelato quote.
The last one needs a live account and a real `productUid` — captured as B841.

## Acceptance

- `/` signed out, credits on: the table is there, with the free list and the
  five credit rows.
- `/` and `/docs` with credits off: nothing rendered, no empty heading.
- Publishing a day to readers by email spends no credits — a ledger with no
  `day_mail` row after a send.
- The postcard preview page quotes 20 credits per card and the arithmetic for
  four cards is 80.
- `npm run verify` passes.
