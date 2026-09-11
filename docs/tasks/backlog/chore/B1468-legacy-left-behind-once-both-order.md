---
id: B1468
title: Legacy left behind once both order surfaces share one element
type: CHORE
priority: medium
complexity: low
area: orders
found: "2026-09-11T14:18:12Z"
---

# B1468 — Legacy left behind once both order surfaces share one element

## Why

Once B1465–B1467 land, several things exist for nobody: the receipt page's tone
tables, `components/PhotobookPrintPanel.tsx` (whose `addressLines` moved into
the shared `Envelope`), the postcard page's own title/intro ladder, and whatever
locale keys those carried.

`npm run unused` catches a file nothing reaches and an export nothing imports.
It does not catch a locale key nobody looks up, or a branch only a demo row can
reach.

## Work

- Run `npm run unused` and clear it.
- Sweep `site/locales/*.json` for `photobook.print.*` and `postcard.page.*` keys
  no file references any more; delete from all three locales and regenerate with
  `npm run i18n:keys`.
- Decide `photobook.print.legacyNoPrintDoor`: it exists for pre-B1157 rows that
  were never bought printed. Check the live database for any such row outside
  the demo journal first — if there is none, the branch and its key go.

## Acceptance

`npm run verify` green with `unused` clean; no locale key in `en.json` without a
reader; the deletion is bigger than the addition.
