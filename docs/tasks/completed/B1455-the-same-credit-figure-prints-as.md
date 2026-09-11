---
id: B1455
title: The same credit figure prints as 220.00 on the page and 284 in the mail
type: CHORE
priority: low
complexity: low
area: credits, i18n, mail
found: "2026-09-11T12:31:26Z"
started: "2026-09-11T12:35:38Z"
merged: "2026-09-11T12:52:15Z"
---

# B1455 — The same credit figure prints as 220.00 on the page and 284 in the mail

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

The same fact about the same order, in two places, in two shapes. On
`/<user>/photobooks/<id>` after B1454:

> Alle **220.00** Credits sind zurück auf deinem Konto

and in the failure mail for the same kind of order:

> alle **284** Credits sind zurück auf deinem Konto

`lib/credits/format.ts:64` is `credits.toFixed(2)`, always two places.
`lib/photobook/receipt.ts:104` is `String(input.creditsRefunded)`, never any.
Neither is wrong on its own; together they read as two systems that do not
know about each other, and `220.00` in particular reads like a machine
printing a database column rather than a person saying how many credits came
back.

**Decimals cannot simply be dropped.** Credits carry hundredths since B987 and
two journals on the live instance hold a fractional balance right now, so
`8.96` has to keep both places. What is wrong is printing `.00` on a number
that has no fraction.

## Work

- `formatCredits` shows a fraction only when there is one: `220` stays `220`,
  `8.96` stays `8.96`, `8.50` stays `8.50` rather than collapsing to `8.5`.
- The mail uses the same function instead of `String(...)`. Sixteen callers
  already share `formatCredits`; the mail is the one that went its own way.
- Check the other senders in `lib/photobook/receipt.ts` and the postcard
  equivalents for the same `String(...)` shortcut while there.

**Not in this ticket.** No change to how credits are stored, to the hundredths
arithmetic, or to what any figure is — this is only how a number is written
down.

## Acceptance

- A whole number of credits prints with no decimal point anywhere in the
  product: page, mail, `/admin`.
- A fractional balance still prints both places.
- The page and the mail for one refused order quote the same string.
- `npm run verify` clean.
