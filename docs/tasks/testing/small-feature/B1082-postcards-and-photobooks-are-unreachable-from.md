---
id: B1082
title: Postcards and photobooks are unreachable from the conversation
type: FEATURE
priority: medium
complexity: medium
area: lib/helper/tools/areas/printed.ts
found: "2026-09-09T15:42:00Z"
merged: "2026-09-09T15:42:46Z"
---

# B1082 — Postcards and photobooks are unreachable from the conversation

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`lib/helper/intents.ts` refused the word "postcard" outright, which was honest
when nothing could propose one. The API door has had postcards since B434 and
photobooks longer, and both end at a button on the owner's own page — so the
part an agent *may* do was never the part that was blocked.

## Work

`postcard_recipients`, `postcard_texts`, `propose_postcards`, `photobook`,
`print_order`. Recipients come from `postcardCandidates()`, which returns a
name, a town and a country and never a street — the address is kept out at the
library boundary rather than by remembering to omit a field.

`propose_postcards` writes a real, pending order and says so. `photobook`
writes nothing at all and hands over the composer's URL, because there is no
order-creation API for one.

## Acceptance

The card names the day, the per-card price, the total and the balance, and the
`done` sentence says a preview is waiting and nothing has been printed.
`test/postcard-orders.test.ts`'s guard — nothing under `app/api` imports
`sendOrder` — still passes.
