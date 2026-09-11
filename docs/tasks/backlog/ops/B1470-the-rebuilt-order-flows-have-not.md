---
id: B1470
title: The rebuilt order flows have not been driven end to end on the live instance
type: OPS
priority: high
complexity: medium
area: orders
found: "2026-09-11T14:18:14Z"
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

## Acceptance

Each of the four driven, with what was seen written down; anything wrong filed
in `backlog/` by id.
