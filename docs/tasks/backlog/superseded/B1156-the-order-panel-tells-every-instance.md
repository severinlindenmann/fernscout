---
id: B1156
title: The order panel tells every instance that nothing will be printed
type: ISSUE
priority: high
complexity: low
area: photobook
found: "2026-09-09T21:30:00Z"
superseded: "B1157 — the panel it lived on was replaced, and the sentence deleted with it"
---

# B1156 — The order panel tells every instance that nothing will be printed

## Why

`app/[user]/(trip)/photobook/BookLevelView.tsx:365` renders
`photobook.orderNotPrinted` unconditionally, directly above the pay button:

> "Nothing is printed and nothing is posted: this instance has no print
> account. The files are yours to take to a printer."

It was true of every instance when it was written and is false on
fernscout.ch as of 2026-09-09, when `features.photobook.provider` was switched
to `gelato` with `live: true`. The owner reads it at the moment they are
deciding whether to spend credits, and it tells them the thing they want is
impossible here.

The comment beside it says "Still a simulation, and it says so before the
receipt rather than after" — the reasoning is right, and the sentence simply
stopped being true without anything noticing. Nothing reads the capability.

## Work

- Show it only when this instance genuinely cannot print — the same question
  `/api/health` answers, which is `provider === "dry-run"` (and, once B1113
  lands, `live`).
- Do not reword it into something vaguer that is true either way. A sentence
  that survives both states says nothing at the moment it matters.

## Acceptance

- With `provider: "gelato"` the sentence is absent.
- With `provider: "dry-run"` it still appears, unchanged.
- `npm run verify`.

## Note

Overlapped by the flow rewrite drafted on 2026-09-09, which removes this panel
in its current form. Kept separate because it is wrong on the live site now and
the rewrite is not yet agreed; if the rewrite lands first, close this as
superseded rather than building it twice.
