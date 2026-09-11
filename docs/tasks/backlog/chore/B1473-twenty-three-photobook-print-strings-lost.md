---
id: B1473
title: Twenty-three photobook print strings lost their reader in B1428 and are still shipped in three languages
type: CHORE
priority: low
complexity: low
area: locales
found: "2026-09-11T15:24:01Z"
---

# B1473 — Twenty-three photobook print strings lost their reader in B1428 and are still shipped in three languages

## Why

Found while sweeping B1468. Twenty-three `photobook.print.*` keys and
`postcard.page.reviewButton` have no reader in `app/`, `components/`, `lib/`
or `scripts/`, and had none *before* the one-order-element programme started
either — they are B1428's leftovers, from the pre-B1157 flow where a book was
built first and printed as a separate press.

They are carried in English, German and Hungarian: three copies of a string
nobody can reach, and each one a line a translator or an agent reads past.

The list as it stood on 2026-09-11: `photobook.print.orderTitle`,
`noLongerEligible`, `chooseSubmit`, `notBuilt`, `unknownCountry`,
`providerUnavailable`, `quote`, `balance`, `short`, `button`,
`result.alreadyPaid`, and every other `photobook.print.result.*`, plus
`postcard.page.reviewButton`.

## Work

Re-derive the list rather than trusting the one above. A naive sweep of all
2352 keys reports 390 false positives, because plural forms (`*.one`) and
constructed keys — `agent.error.` plus a code — are looked up dynamically and
never appear as a literal. A key is dead only if nothing outside `lib/i18n.ts`
names it *and* no call site builds it; confirm each candidate by reading for
its caller.

Then delete from all three locales and run `npm run i18n:keys`.

## Acceptance

`npm run verify` green; every deleted key demonstrably unreachable, and the
commit message names them.
