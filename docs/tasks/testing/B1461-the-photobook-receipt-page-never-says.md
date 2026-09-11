---
id: B1461
title: The photobook receipt page never says what the book cost
type: FEATURE
priority: medium
complexity: low
area: photobook receipt
found: "2026-09-11T13:21:06Z"
started: "2026-09-11T13:21:24Z"
merged: "2026-09-11T13:30:55Z"
---

# B1461 — The photobook receipt page never says what the book cost

## Why

`app/[user]/photobooks/[id]/page.tsx` is headed "Your order" and reads as a
receipt, but it is the one page in the photobook flow with no price on it.
The price is shown at the till (`BookLevelView.tsx:442`, `photobook.price` —
credits and about-CHF) and then never again. The owner who comes back to
`/severin/photobooks/<id>` a week later can see what was printed, where it
went and how to download it, and cannot see what they paid.

`order.payload.credits` is exactly the frozen number that was charged, and
`creditsInRappen`/`formatChf` already turn it into money. Nothing has to be
computed or stored.

## Work

An invoice block on the receipt page: what the book was, what it cost in
credits, the same figure in about-CHF, the date, and the order reference.

- Refused print (`print.failure`): show the charge and a refunded line, so
  the total reads zero. Do not duplicate `photobook.print.refusedRefunded`'s
  sentence — the block is the figures.
- Not doing: Gelato's own `quotedMinor` / `quotedCurrency`. That is the
  operator's cost, not the owner's business — B1165.
- Not doing: a PDF or printable invoice, a VAT line, or a per-line split of
  print vs postage. There is one price (B1425) and one number stored.

New strings in `en`, `de`, `hu` + `npm run i18n:keys`.

## Acceptance

`/{user}/photobooks/{id}` for a paid book shows the credits charged and the
about-CHF figure; the same page for a refused print shows the refund and a
zero total. `npm run verify` green.
