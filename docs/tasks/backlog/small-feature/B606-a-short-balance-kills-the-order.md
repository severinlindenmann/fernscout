---
id: B606
title: A short balance kills the order button instead of explaining itself
type: FEATURE
priority: medium
complexity: low
area: photobook, postcards
found: "2026-09-06T15:08:43Z"
---

# B606 — A short balance kills the order button instead of explaining itself

## Why

Both paying buttons go dead when the balance will not cover the order, and a
dead button reads as a broken page rather than as a price.

- `app/[user]/(trip)/photobook/BookLevelView.tsx:294` — `tooPoor` sits in the
  Pay button's `disabled=`.
- `app/[user]/postcards/[id]/page.tsx:475-479` — `short` makes the send link
  `pointer-events-none` and gives it no `href`.

Both pages *do* print the shortfall and a link to `/<user>/me` beside the
control, so the information is there; what is missing is that pressing the
thing you came for does anything at all. On the live instance every real
journal is metered at zero credits, so this is what an owner meets the first
time they arrange a book — the whole feature looks disabled rather than
priced.

Nothing about the gate is load-bearing. `app/[user]/photobook/order/route.ts:158`
checks the balance and returns `no_credits` **before** a page is drawn or a
credit moves, and the page already renders `photobook.noCredits` for it;
`lib/postcard/send.ts:173` is all-or-nothing and returns `no_credits` the same
way, mapped at `app/[user]/postcards/[id]/page.tsx:66`. The client-side gate
saves one cheap round trip and costs the owner the ability to reach the price.

## Work

- Drop `tooPoor` from the photobook Pay button's `disabled=`.
- Drop `short` from the postcard send link's `href`, `aria-disabled` and
  class, and from the confirm-panel condition.
- Suppress `postcard.confirm.cost` when short — "leaving you -3" is not a
  sentence, and the shortfall line above it already carries the number and
  the place to buy.

Not doing: any change to the two server refusals, to the shortfall messages,
or to how credits are bought.

## Acceptance

On a journal with fewer credits than the order costs:

- The photobook Pay button is pressable; pressing it comes back to the page
  with "There were not enough credits left to pay for this book, and nothing
  was charged." and no book is built.
- The postcard send link is pressable, reaches the confirmation, and pressing
  send comes back with the no-credits result; nothing is posted and nothing
  is charged.
- The shortfall sentence and its "buy credits" link are still on both pages.
