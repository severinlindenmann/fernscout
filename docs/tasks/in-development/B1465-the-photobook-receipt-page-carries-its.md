---
id: B1465
title: The photobook receipt page carries its own pill table and envelope markup
type: FEATURE
priority: high
complexity: low
area: orders
found: "2026-09-11T14:18:07Z"
started: "2026-09-11T14:53:54Z"
session: 3f748903-2dc3-47a2-a958-98b83d641dc0
claimed: "2026-09-11T14:53:54Z"
---

# B1465 — The photobook receipt page carries its own pill table and envelope markup

## Why

`app/[user]/photobooks/[id]/page.tsx` is 401 lines, of which the pill tone
tables, the envelope markup and the ledger are now duplicated by
`components/order/` (B1464). Two copies of a status vocabulary is how the
vocabularies drift.

## Work

Replace the body of the receipt page with `photobookOrderView` + `OrderDocket`.
`KNOWN_STATUSES`, `TONE_CLASSES` and `DOT_CLASSES` move out of this file and do
not survive in it. The Gelato lookup (`fetchOrderStatus`) stays on the page — it
is a network call and belongs in the server component, not in a view model.

Tracking rows and the download list keep every behaviour they have.

## Acceptance

The live order `9f1b3820` renders with the same facts as before — refused pill,
refund line, zero total, envelope, `book.pdf` — at 1440 and 390. `npm run
verify` green, and the file is materially shorter.
