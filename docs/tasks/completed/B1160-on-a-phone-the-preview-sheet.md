---
id: B1160
title: On a phone the preview sheet covers the Ask button, so a typed message cannot be sent
type: ISSUE
priority: high
complexity: low
area: components/HelperRoom.tsx
found: "2026-09-09T19:32:19Z"
merged: "2026-09-09T19:41:23Z"
---

# B1160 — On a phone the preview sheet covers the Ask button, so a typed message cannot be sent

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Found by driving the live site at 390 x 844 on 2026-09-09, immediately after
B1121 shipped the preview sheet.

`PreviewSheet` (`components/HelperRoom.tsx:1020`) is
`fixed inset-x-0 bottom-0 z-20`. The composer inside `HelperAsk` is
`sticky bottom-0` with no stacking context of its own
(`components/HelperAsk.tsx:894`). So the peeking sheet sits **over** the
composer, and the "Ask" button is underneath it.

Playwright's ordinary click failed twice, reproducibly, with *"element
intercepts pointer events"*; the check only continued by forcing the click
through JavaScript. A person cannot do that. They tap Ask, the preview sheet
takes the tap, and the message is not sent — with no error, because nothing
went wrong as far as the software is concerned.

This is the worst kind of regression from B1121: the sheet works, the peek
works, and the thing underneath it silently stops working.

## Work

The peek must not overlap the composer. The composer is the primary control on
the screen and the sheet is a glance.

The shape to reach for: **peek is in the flow, expanded is an overlay.** A
112px peek rendered as a sibling above `HelperAsk` costs nothing and cannot
cover anything; only the dragged-open sheet needs to be `fixed`, and at that
point covering the composer is what a person asked for.

Raising the composer's z-index instead is the tempting one-liner and is wrong:
it leaves the composer floating on top of the sheet, so the peek is half
hidden behind it and the seam moves rather than closes.



## Acceptance

At 390px with a day named and the sheet peeking, tap Ask with an ordinary tap
and the message sends. Assert it with a click that does **not** pass `force`:
the whole defect is that a forced click works and a real one does not.
