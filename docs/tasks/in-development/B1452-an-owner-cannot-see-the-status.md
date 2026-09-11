---
id: B1452
title: An owner cannot see the status of their photobook and postcard orders in one place
type: FEATURE
priority: medium
complexity: medium
area: app/[user]/account, lib/postcard/orders.ts, lib/photobook/orders.ts
found: "2026-09-11T12:07:33Z"
started: "2026-09-11T12:35:10Z"
session: 96bf5e0d-32d8-48d5-acef-17f7a5c44f82
claimed: "2026-09-11T12:35:10Z"
---

# B1452 — An owner cannot see the status of their photobook and postcard orders in one place

## Revalidation

Valid. Confirmed by reading `lib/postcard/orders.ts` and
`lib/photobook/orders.ts`: `getOrder`/`getPhotobookOrder` each read one row by
id, and neither module (nor anything under `app/[user]/account`) has a
function that lists every `print_orders` row for an owner. No page under
`app/[user]/` reads `print_orders` without an id already in hand.

## Why

An owner who has proposed several photobooks and postcards has no page that
lists them. Each order only exists as a link handed over at the moment it was
created (`/<user>/postcards/<id>`, `/<user>/photobooks/<id>`) — lose that link
and there is no way back to it, and no way to see at a glance which orders are
still drafts, which were submitted, and which the print provider actually
built. Both kinds already share one table (`print_orders`, `owner_id` +
`kind` + `status` since `001-initial`, read by `lib/postcard/orders.ts` and
`lib/photobook/orders.ts`), so the data to answer "what have I ordered" exists
and nothing reads it back as a list.

## Work

A new owner-only page, `/<user>/orders`, listing every `print_orders` row for
that owner across both kinds, newest first. Each row shows: kind (photobook /
postcard), created date, status, price (in credits/CHF, using the same
`formatChf`/pricing helpers `/account` already uses), and a link to the
order's own page (`/<user>/postcards/<id>` or `/<user>/photobooks/<id>`).

Reached via a link from the existing `/<user>/account` page — no new entry in
`SiteNav`/`navDestinations.ts`. Gated the same way `/account` is:
`isOwner(user)` and `notFound()` otherwise (see
`app/[user]/account/page.tsx`).

Not doing: no filtering/pagination (a person's own order count is small), no
new nav icon, no changes to how an order's own status page works, no
change to the guests/buddies write path.

## Acceptance

Signed in as an owner with at least one postcard and one photobook order in
different statuses, `/<user>/orders` lists both, each with a correct status
and a working link to its own page. A signed-out or non-owner request to the
same URL gets `notFound()`. A link to `/<user>/orders` is visible on
`/<user>/account`.

## Follow-up from review (2026-09-11)

Three things came back from a person looking at the merged page on
fernscout.ch/severin/account:

1. **The orders link was at the bottom of `/account`; move it to the top.**
2. **Show a preview of the last 3 orders directly on `/account`**, with a
   "more" link to `/orders` only when there are more than 3.
3. **A real bug**: a photobook order the printer had actually refused showed
   as "Bereit" (built/ready) instead of "Abgelehnt" (refused). Cause:
   `markPrintFailed` (`lib/photobook/orders.ts`) returns a refused print's
   `status` column to `built` and records the refusal only in
   `payload.print.failure` — the same trick `app/[user]/photobooks/[id]/page.tsx`
   already accounts for on the single-order page. The `/orders` list read
   `order.status` alone and missed it.

### Work (follow-up)

New `lib/orders.ts`: `listAllOrders(owner)`, the shared row-builder both
pages now use, replacing the postcard/photobook merge that used to live
directly in `app/[user]/orders/page.tsx`. It derives a photobook row's display
status from `status` **and** `payload.print` — `built` + `print.failure` →
`"refused"`, `print_submitted` + `print.shippedAt` → `"shipped"` — rather than
the raw `status` column alone. No live Gelato call: both signals it needs are
already written locally by the existing reconcile/webhook path (B1336/B1345),
same as the fix in B1451.

`/account` now renders an "orders" card at the top of the page (before
Payment/Storage), showing up to 3 most recent orders with a "view all" link to
`/orders` when there are more. Hidden entirely when there are none. The old
plain link card at the bottom is removed — this replaces it.

### Acceptance (follow-up)

An owner with 4+ orders sees the newest 3 at the top of `/account`, with a
"view all" link to `/orders`; an owner with ≤3 sees all of them and no such
link. An owner with 0 orders sees no orders section on `/account` at all. A
photobook order with `payload.print.failure` set shows "Abgelehnt"/"Refused"
everywhere it appears (`/account` preview and `/orders`), not "Bereit"/"Ready".
