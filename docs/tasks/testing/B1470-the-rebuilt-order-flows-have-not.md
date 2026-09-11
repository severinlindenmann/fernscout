---
id: B1470
title: The rebuilt order flows have not been driven end to end on the live instance
type: OPS
priority: high
complexity: medium
area: orders
found: "2026-09-11T14:18:14Z"
started: "2026-09-11T15:25:53Z"
merged: "2026-09-11T15:30:56Z"
---

# B1470 — The rebuilt order flows have not been driven end to end on the live instance

## Why

Both order surfaces are pages, and a page is finished when somebody has looked
at it — on content that existed before the branch, not on the fixture the change
was written against (B1090). The bench (B1464) proves the component; only the
live instance proves the flows.

## Work

On fernscout.ch, with the owner's own cookie:

- The real photobook order `9f1b3820` (refused and refunded) at 1440 and 390.
- A photobook bought end to end on a test journal: wizard, composer, envelope,
  price, press, building, order page. Credits are real — use a test journal.
- A postcard order proposed by an agent and carried through Look, Write, Send,
  including editing the agent's words and seeing them saved.
- One order in German and one in Hungarian, to catch a string that only reads
  in English.

Deliverable is findings and tickets, not a diff.

## What was driven, and what it showed

Deployed commit `33001b61bc67`, 2026-09-11. Captures in `/tmp/b1470-live/`.

**The real photobook order `9f1b3820`, at 1280 and 390** — the docket layout,
the coral *Refused* pill (Gelato answers on the live instance, where a local
checkout has no key and honestly says *Unknown*), the envelope, the ledger
with its refund line and zero total, the download row. No console error, no
failed request, no horizontal scroll.

**The photobook buy panel, at 390**, walked to through the wizard on the
owner's own trip and *not* pressed: the same envelope and the same Price card
the receipt shows, 238 credits and about CHF 47.60 in both places — which is
the whole of what B1466 was for. The balance sits in the card's meta row.

**A sent postcard order** — head and pill from the shared vocabulary, and for
the first time a price after sending: 20 credits each × 1, total 20, about CHF
4.00. That page used to say what the cards cost only on the screen you pressed
the button on.

**A pending postcard order** — the shared ledger card inside the send step,
the balance, the warning and the button with its price, all unchanged in
behaviour. Nothing was sent.

**In German**, the receipt reads as a German page throughout.

**In Hungarian it does not, and that is the one finding: B1474.** The title,
the status and the refund sentence come back in English, because `hu.json`
holds the English string as its value for those keys — 69 of them across the
site. Not caused by this programme; caught by reading a real order in a third
language, which is what this ticket was for.

## Acceptance

Each of the four driven, with what was seen written down; anything wrong filed
in `backlog/` by id.
