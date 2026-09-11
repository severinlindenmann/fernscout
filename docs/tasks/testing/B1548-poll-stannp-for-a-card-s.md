---
id: B1548
title: Poll Stannp for a card's status when the order page is opened
type: FEATURE
priority: medium
complexity: low
area: postcards
found: "2026-09-11T22:42:22Z"
started: "2026-09-11T22:42:31Z"
merged: "2026-09-11T22:52:01Z"
---

# B1548 — Poll Stannp for a card's status when the order page is opened

## Why

`app/api/webhooks/stannp/route.ts` is the only way this instance learns
anything from Stannp after a card is sent, and it only ever fires on
cancellation — Stannp has no push for `printing`/`dispatched`, and there is
no websocket integration yet (owner's own words). So `/severin/postcards/<id>`
can sit on `withPrinter` for weeks with no way to tell that Stannp actually
moved the card along, confirmed live against mailpiece 215161865
(dashboard: `Received`, 2026-09-11).

Stannp does have a pollable per-card endpoint the codebase never called:
`GET https://api-eu1.stannp.com/v1/postcards/get/<id>` (the id goes in the
**path**, not `?id=` — that returns `"Missing resource ID"`), same HTTP
Basic auth as sending. Confirmed live: returned
`{"success":true,"data":{"id":215161865,...,"status":"received",...}}`
matching the dashboard.

## Work

- `lib/postcard/stannp.ts`: `fetchStannpStatus(ref)` — parses the numeric id
  out of a `stannp:<id>` / `stannp-test:<id>` ref, calls the `get` endpoint,
  and returns one of `received | printing | dispatched | cancelled`, or
  `null` on no key / no match / any failure / any other word. Deliberately
  stops before `delivered`/`local_delivery`/`returned` — the same boundary
  the webhook already drew (its own module comment: "this system will never
  know whether a card was delivered"). This is reachability, not a reversal
  of that decision.
- `lib/postcard/orders.ts`: widen `RecipientResult.providerStatus` to the
  same four words; add `refreshProviderStatuses(order)` — best-effort, walks
  `payload.results`, asks Stannp for anything `ok` and not already
  `cancelled`, writes back only what changed.
- `app/[user]/postcards/[id]/page.tsx`: call it once, only for a settled
  order (`built`/`failed`), before rendering.
- Not built: showing `providerStatus` anywhere in the UI. It wasn't shown for
  `cancelled` either (webhook has stored that since B1484 with nothing
  reading it, per B1532) — this task only closes the reachability gap the
  owner asked about, not the display gap.

## Acceptance

- `npx vitest run test/postcard-orders.test.ts` (or wherever `orders.ts` is
  covered) passes with a test asserting `refreshProviderStatuses` writes a
  new status and never writes `delivered`/`returned`/`local_delivery` even if
  a fixture returns one.
- Opening `/severin/postcards/<id>` for an order whose Stannp ref is
  `received` today still renders; no user-visible change, since display is
  out of scope.
- `npm run verify` green.
