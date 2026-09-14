---
id: B1659
title: helper buy_room spends with no idempotency ref, unlike the v2/web storage purchase door
type: ISSUE
priority: low
complexity: low
area: Helper / Money
found: "2026-09-13T10:20:00Z"
merged: "2026-09-13T14:28:05Z"
completed: "2026-09-14T16:32:32Z"
---

# B1659 — helper buy_room spends with no idempotency ref, unlike the v2/web storage purchase door

## Why

`app/api/helper/[user]/storage/route.ts` (the `buy_room` tool) calls
`spend(user, EXTRA_STORAGE_CREDITS, "storage", \`${user}/storage\`)` — the
same constant `ref` on every call. `lib/credits.ts`'s `spend()` has no
idempotency of its own (it just decrements the balance and inserts a ledger
row unconditionally), so a retried POST — a network retry, a double press —
spends twice.

`app/api/web/[user]/storage/purchases/[id]/route.ts` (the newer, v2-era
owner-cookie door for the same purchase) fixed exactly this: a client-chosen
id folded into the ledger `ref`, checked with `ledgerHasRef` before spending,
so a retried PUT with the same id is a no-op re-read rather than a second
charge.

Not a v2/v1 storage-format conflict (storage purchase touches no document,
so B1650's completeness conflict does not apply here) — just a pre-existing
double-charge risk in the helper's own flow that the newer door happens to
have fixed and the older one has not been given the same fix.

## Work

Not started. Smallest fix: have `buy_room`'s `propose` mint a client id (the
same way `postcards/orders/[id]` and `.../storage/purchases/[id]` do) and
pass it as a hidden field through the confirm step, and have the route call
`ledgerHasRef` before `spend()` the way `.../storage/purchases/[id]` does —
or, more simply, have the helper route call into that same web route's writer
in-process rather than reimplementing the spend.

## Acceptance

A test that presses `buy_room`'s confirm twice with the same proposal (as a
double-submit would) and asserts only one charge landed in `credit_ledger`.
