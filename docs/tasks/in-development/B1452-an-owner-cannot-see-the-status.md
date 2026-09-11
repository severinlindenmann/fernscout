---
id: B1452
title: An owner cannot see the status of their photobook and postcard orders in one place
type: FEATURE
priority: medium
complexity: medium
area: app/[user]/account, lib/postcard/orders.ts, lib/photobook/orders.ts
found: "2026-09-11T12:07:33Z"
started: "2026-09-11T12:09:40Z"
session: 96bf5e0d-32d8-48d5-acef-17f7a5c44f82
claimed: "2026-09-11T12:09:40Z"
---

# B1452 — An owner cannot see the status of their photobook and postcard orders in one place

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
