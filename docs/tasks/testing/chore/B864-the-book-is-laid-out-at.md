---
id: B864
title: The book is laid out at three sizes Gelato cannot print
type: CHORE
priority: high
complexity: medium
area: photobook, print
found: "2026-09-07T17:29:29Z"
started: "2026-09-07T17:35:12Z"
merged: "2026-09-07T18:15:27Z"
---

# B864 — The book is laid out at three sizes Gelato cannot print

## Why

`BOOK_SIZES` in `lib/photobook/spec.ts:32` offers 210 x 210 square, A4
landscape and A4 portrait. A probe against the live Gelato API on 2026-09-07
found that **none of the three exists.** Gelato prints 200 x 200, 210 x 280 and
280 x 280 (hardcover), and nothing else above 140 x 215.

`BINDING_PROFILES` is wrong in every row, which its own `verified: false`
predicted: the real rule is **28-200 pages, step 2**, identical on every
photobook product. `SADDLE_STITCH` describes a product Gelato does not sell at
all — `BindingType` is `glued-left` and nothing else.

The `productUid` `buildGelatoRequest` constructs
(`lib/photobook/providers.ts:161`) was invented. Real ones are opaque catalogue
strings, and `pageCount` is a sibling field rather than part of the uid.

Everything downstream is therefore printable by nobody. This is what B841 asked
for and considerably more than it expected to find.

## Work

The whole of `docs/superpowers/plans/2026-09-07-photobook-gelato-formats.md`,
which is written out task by task. In short:

- `BOOK_SIZES` becomes the three Gelato prints, keyed `square` / `portrait` /
  `large-square`, each carrying its verbatim `productUid` and its cover type.
  Ids stop being measurements so they cannot lie again.
- `BINDING_PROFILES`, `SADDLE_STITCH` and `portableRule()` are deleted and
  replaced by one `GELATO_PAGE_RULE` of 28-200 step 2.
- `binding` leaves `BookOptions`. `parseOptions` must still read an order
  stored with it, or every existing order becomes unreadable.
- `PHOTOBOOK_PRICING_VERIFIED` becomes `true`. The measured basis is CHF 6.04 +
  0.161 a page plus CHF 8.52 postage; a 52-page square book lands at CHF 22.92,
  printed in Switzerland.
- The hardcover cover case is the last task and is droppable.

Not doing: the print flow itself, which is B865.

## Acceptance

- `npm run verify` passes.
- `npm run photobook -- --providers` lists three sizes, all of them Gelato's.
- A 9-page trip normalises to 28 pages, not 32; a 53-page trip to 54, not 56.
- `docs/providers/photobook.md`'s geometry and page-count tables match
  `lib/photobook/spec.ts`, and its price table carries the four quoted figures.
- Known consequence, to be stated when it ships: a short trip pads to 28 pages
  instead of stapling at 12, because Gelato offers no saddle stitch.
