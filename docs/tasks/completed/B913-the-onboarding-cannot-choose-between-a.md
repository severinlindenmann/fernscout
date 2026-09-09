---
id: B913
title: The onboarding cannot choose between a soft and a hard cover
type: FEATURE
priority: high
complexity: medium
area: photobook, onboarding
found: "2026-09-08T05:29:08Z"
merged: "2026-09-08T05:29:26Z"
completed: "2026-09-09T16:44:55Z"
---

# B913 — The onboarding cannot choose between a soft and a hard cover

## Why

The cover was a property of the size: `square` and `portrait` *were*
softcovers and `large-square` *was* a hardcover, so nobody could ask for a
hardcover square, and nothing in the product said what the difference is.

Gelato binds both in two of the three sizes, and the prices differ — at 52
pages, square CHF 14.40 soft against 18.35 hard.

## Work

Built and merged 2026-09-08.

- `BookOptions.coverType` (`"soft" | "hard"`, default soft). `BOOK_SIZES` sizes
  carry `covers: { soft?, hard? }`; `productUidFor`, `sizesFor` and
  `defaultSizeFor` resolve them. A size Gelato does not bind in a cover has no
  entry rather than a fallback.
- A fourth size, the 140 x 140 pocket softcover, so each cover offers three.
- **The cover is asked before the size**, and the size grid is filtered to it —
  three either way, so nothing is greyed out. Changing the cover corrects an
  incompatible size.
- `FormatShape` draws the difference: a hardcover's boards overhang the pages
  on three edges with a groove beside the spine, a softcover is flush with
  rounded corners. The overhang is deliberately exaggerated — the real one is
  about 3 mm on a 200 mm board and invisible at 56 px.
- Descriptions saying what the difference is, and that choosing hardcover does
  not change what building the book costs, only what printing it costs.
- The same control on `BookSettingsPanel`.

Two things found while building it and fixed here:

- `photobook.first.sizeHint` said the size was "the only answer that changes
  what it costs". It had not been true since the build charge went flat.
- `defaultSizeFor` was deleted as dead code by B896 between the model landing
  and the wizard that calls it, which took the composer down with a 500 until
  it was restored.

## Acceptance

- Verified in a browser on fernscout.ch: the cover step is the first question,
  softcover offers pocket/square/portrait and hardcover offers
  square/portrait/large-square, and the two drawings are distinguishable.
- `npm run verify` passes.
