---
id: B1463
title: A photobook order and a postcard order are two pages with no shared vocabulary
type: FEATURE
priority: high
complexity: medium
area: orders
found: "2026-09-11T14:18:04Z"
started: "2026-09-11T14:25:57Z"
session: 3f748903-2dc3-47a2-a958-98b83d641dc0
claimed: "2026-09-11T14:25:57Z"
---

# B1463 — A photobook order and a postcard order are two pages with no shared vocabulary

## Why

`app/[user]/photobooks/[id]/page.tsx` and `app/[user]/postcards/[id]/page.tsx`
answer the same four questions — what is this, where does it stand, what did it
cost, who is it going to — and share not one line of code. The envelope block is
hand-written three times (`BookLevelView.tsx:380`, `photobooks/[id]/page.tsx:321`,
and again inside the postcard people list); the status pill, its tone table and
its context sentences live only on the photobook receipt; the price ledger
shipped this morning on one page and not the other (B1461).

Every future change to an order is therefore two changes, and the two have
already drifted: the photobook receipt says what a book cost, the postcard page
never says what the cards cost after they are sent.

## Work

A product-agnostic view model, and nothing rendered yet — this ticket must be
invisible in a browser.

- `lib/order/view.ts`: an `OrderView` type with the six slots the drafts settle
  on — `head`, `status`, `ledger`, `recipients`, `object`, `action` — plus
  `meta` (ordered-at, reference).
- `photobookOrderView(order, trip, locale)` and `postcardOrderView(order, …)`,
  each mapping its own payload onto it. The Gelato status mapping and the
  "unmapped words keep their raw English and the neutral tone" rule move here
  from `photobooks/[id]/page.tsx` intact.
- Unit tests per adapter: a paid book, a refused-and-refunded book, a pending
  proposal, a sent set, an unmapped provider word.

Not doing: any JSX, any route change, any deletion. The old pages keep
rendering exactly as they do.

## Acceptance

`npx vitest run test/order-view.test.ts` green; `npm run verify` green; a `git
diff` that touches no file under `components/` and no `page.tsx`.
