---
id: B555
title: The unconverted-costs notice still tells a reader to ask an agent to add a rate that now arrives on its own
type: DOCS
priority: low
complexity: low
area: costs, currency, i18n
found: "2026-09-06T09:12:13Z"
started: "2026-09-07T10:37:31Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T10:37:31Z"
---

# B555 — The unconverted-costs notice still tells a reader to ask an agent for a rate that now arrives on its own

## Why

`cost.unconverted`, in all three locale files, ends: "Ask an agent working on
this journal to add the missing rates." Since B543 a missing rate the ECB
publishes fills itself, on the next day write or the next `npm run rates:fill`
— so for most currencies the advice sends a reader to ask for something that
is already on its way, and for the rest (a currency the ECB does not publish,
or a date older than ninety days) it is still exactly right without saying
which case this is.

Found while building B543.

## Work

Rewrite the sentence in `en`, `de` and `hu` so it distinguishes the two: a
rate that is coming, and a rate that genuinely needs a person — the currencies
outside the ECB's list, which want `site.manualRates`. The page already knows
which currencies are unconverted; whether it should say which case each one is
in is the design question this task is really asking.

## Acceptance

- The notice no longer asks for something the server does by itself.
- All three locales say the same thing.
- `npm run verify` passes.

## Done, 2026-09-07

Rewrote `cost.unconverted` in all three locales (`site/locales/{en,de,hu}.json`).
It no longer asks a reader to ask an agent. New text distinguishes the two
cases generically (per the Work section's own framing of the design
question, left as generic rather than naming which case each currency is
in): most currencies fill in on their own within a day or so (B543's
automatic ECB fill), while a currency the ECB does not publish, or a payment
more than ninety days old, needs a rate added to the journal's own
`manualRates` (`lib/rates.ts:97-118`) instead. Kept it generic rather than
computing per-currency which case applies — the page (`UnconvertedNotice.tsx`)
renders one shared string for the whole list of unconverted amounts, and
doing better would be a second ticket.

`npm run verify` passed.
