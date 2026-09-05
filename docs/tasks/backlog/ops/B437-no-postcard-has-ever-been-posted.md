---
id: B437
title: No postcard has ever been posted through a real provider account
type: OPS
priority: medium
complexity: medium
area: postcards
found: "2026-09-05T10:12:33Z"
---

# B437 — No postcard has ever been posted through a real provider account

## Why

B107 already records that postcards have only ever run dry. B434 and B435 leave
that true on purpose — the repository rule is that no feature needs a paid
account to develop, so the whole flow is built and tested against `dry-run`.

What no test can tell us is whether a card printed from our PDF is *correct on
paper*: whether the bleed survives their trimming, whether the address block
lands where a sorting machine reads it, whether the photograph is as soft as
the 2000 px derivative cap suggests it might be. That is an engagement against
a funded account, and its deliverable is findings.

## Work

Against the live instance, with a funded print.one account:

1. Fund the account, set `PRINTONE_API_KEY`, enable the `postcards` capability
   for one journal, confirm `/api/health` explains its state correctly both
   before and after.
2. Order one card to the operator's own address, through the preview page,
   pressing Send by hand. Watch the ledger: `15` credits out, one row, the
   right `ref`.
3. When it arrives: measure it. Trim against the 148 × 105 intent, address
   block position, photograph sharpness at arm's length, colour against the
   screen preview.
4. Order a second with a **portrait** source photo, which the design expects to
   warn as low resolution. Confirm the warning was honest.
5. File what is wrong as new tasks.

## Acceptance

Two cards in hand, photographed, with the measurements written into
`docs/providers/postcards.md`, and a task filed for every discrepancy — or a
line saying there were none. Not a diff.

## Depends on

B434 and B435.
