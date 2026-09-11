---
id: B1468
title: Legacy left behind once both order surfaces share one element
type: CHORE
priority: medium
complexity: low
area: orders
found: "2026-09-11T14:18:12Z"
started: "2026-09-11T15:17:44Z"
merged: "2026-09-11T15:24:48Z"
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

## What was found, and what was decided

**`photobook.print.legacyNoPrintDoor` stays**, and the query is why: the live
database holds 58 photobook orders with no `print` block, and every one of them
belongs to `example` — the demo journal this instance actually serves at
`/example`. The ticket said the branch goes if nothing outside the demo has
one; nothing does, but the demo's own order pages are the first thing a
prospective owner opens, and leaving 58 of them with no explanation of why
there is no print door is worse than carrying one string.

**Three keys died with this programme** and are gone from all three locales:
`photobook.price`, `photobook.print.heading`, `postcard.page.cost`.

**Twenty-three more were already dead before it** — B1428's leftovers. Captured
as B1473 rather than absorbed here; they are not this programme's mess.

**`components/PhotobookPrintPanel.tsx` is deleted.** `addressLines` moved to
`lib/order/address.ts` — its own small file because the two callers cannot
share a larger one: `lib/order/view.ts` reaches `server-only` code, and the
composer that also needs it is a client component. `PanelRecipient` moved
beside the recipients it describes, in `lib/photobook/recipients.ts`.

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
