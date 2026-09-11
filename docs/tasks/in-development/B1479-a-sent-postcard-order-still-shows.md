---
id: B1479
title: A sent postcard order still shows the editing stepper instead of the order it has become
type: FEATURE
priority: high
complexity: low
area: orders
found: "2026-09-11T15:51:06Z"
started: "2026-09-11T16:23:29Z"
session: 3f748903-2dc3-47a2-a958-98b83d641dc0
claimed: "2026-09-11T16:23:29Z"
---

# B1479 — A sent postcard order still shows the editing stepper instead of the order it has become

## Why

B1467 was meant to make both roads end on the same element, and it did not
finish the postcard half. `app/[user]/postcards/[id]/page.tsx` borrows three
pieces — the pill, the ledger card, and the head strings from
`postcardOrderView` — and never renders `OrderDocket`. The photobook road does.

So a **sent** order still renders the composing stepper: `1 Look · 2 Write ·
3 Send`, a crop slider and a message field, all read-only, under a green
*Shipped* pill. There is nothing left to compose on an order that is with the
printer, and the controls invite an edit that cannot happen.

Three fields the adapter already computes have no reader on this side:
`view.object` (the card front), `view.recipients`, `view.meta`. That is the
tell — the view model is complete and only the page is half-converted.

The plan (`docs/plans/2026-09-11-one-order-element.md`) and the approved
drafts both show screen 05 as the docket. The deviation is recorded in B1467's
own file; this is the ticket that closes it.

## Work

When an order is settled — sent, refused, or expired unsent — render
`OrderDocket` in place of the stepper:

- `object`: the card front, with the crop the order carries.
- `recipients`: the list already computed, names and towns; the street stays
  behind the disclosure the page has today.
- `ledger` and `meta`: as computed.
- No action slot: there is nothing to press.

**Pending is untouched.** Look, Write and Send stay exactly as they are — that
is composing, and composing is not an order. The page's own read-only branches
for the stepper come out with it; check what else `settled` still guards.

Not doing: the postcard front is a rendered preview rather than a stored
image, so how the plate gets its picture is the one thing to work out —
`PostcardCropper` renders it client-side today.

## Acceptance

A sent order at 390 and 1280 shows the docket and no stepper; a pending order
is pixel-identical to today; `npx vitest run test/postcard-orders.test.ts`
green, and `sendOrder` still unreachable from `app/api`.
