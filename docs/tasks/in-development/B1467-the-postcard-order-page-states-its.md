---
id: B1467
title: The postcard order page states its own heading, intro and price in its own words
type: FEATURE
priority: high
complexity: medium
area: orders
found: "2026-09-11T14:18:10Z"
started: "2026-09-11T15:09:48Z"
session: 3f748903-2dc3-47a2-a958-98b83d641dc0
claimed: "2026-09-11T15:09:48Z"
---

# B1467 — The postcard order page states its own heading, intro and price in its own words

## Why

`app/[user]/postcards/[id]/page.tsx` picks its title, intro and price sentence
from a ladder of three order states in its own strings, and never shows a
ledger at all: after sending, the page says the cards went, and nowhere says
what they cost. The photobook receipt has said so since B1461.

## Work

- The page's head and its post-send body render `OrderDocket` from
  `postcardOrderView`.
- The `Send` step's panel (`PostcardSend.tsx`) renders the shared `Ledger`,
  `Envelope` list and `ActionRow` instead of its own.
- `Look` and `Write` are untouched. They are composing, and the editable back
  (`PostcardBack`, saved on a 700ms debounce) keeps every behaviour — including
  that an agent's words are a first draft the owner writes over.

**The one thing that must not move**: `sendOrder` stays unreachable from
`app/api` — `test/postcard-orders.test.ts` asserts it, and this ticket must not
weaken that assertion.

## Acceptance

A pending order shows the ledger and the press; a sent order shows the ledger
and no press; a failed order shows the refund. `npx vitest run
test/postcard-orders.test.ts` green, at 1440 and 390.
