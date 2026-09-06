---
id: B555
title: The unconverted-costs notice still tells a reader to ask an agent to add a rate that now arrives on its own
type: DOCS
priority: low
complexity: low
area: costs, currency, i18n
found: "2026-09-06T09:12:13Z"
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
