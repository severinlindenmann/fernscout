---
id: B1484
title: Stannp has no inbound webhook route, unlike every other print/message provider
type: ISSUE
priority: medium
complexity: medium
area: postcards
found: "2026-09-11T16:35:58Z"
started: "2026-09-11T20:18:05Z"
session: 01ffdab4-e3d9-4d0a-810b-5d15c09d3f77
claimed: "2026-09-11T20:18:05Z"
---

# B1484 — Stannp has no inbound webhook route, unlike every other print/message provider

## Why

`app/api/webhooks/` has routes for gelato, stripe, twilio, and whatsapp, but
none for stannp — confirmed by directory listing during the managed-instance
testing-framework plan (docs/superpowers/plans/2026-09-11-managed-instance-testing-framework.md).
Without it, a card Stannp cancels after already accepting it — a bad address
caught downstream, the same gap Gelato's own webhook closes for photobook —
had no way to be known here at all.

**Two corrections found while building this, both worth recording since the
original capture guessed wrong on both:**

- **Stannp does sign its webhooks**, unlike Gelato — confirmed against
  Stannp's own published docs (webhooks.stannp.com,
  knowledge.stannp.com). `X-Stannp-Signature` is an HMAC-SHA256 of the raw
  body, keyed on the secret set when the webhook is created in Stannp's
  dashboard. `app/api/webhooks/gelato/route.ts`'s bare-header-compare shape
  does not apply; this route verifies a real HMAC instead.
- **`STANNP_WEBHOOK_SECRET` does not belong in `lib/capabilities.ts`.**
  Checked: `GELATO_WEBHOOK_SECRET` isn't there either — it's read directly
  by the webhook route itself, optional, with the route 404ing when unset.
  `STANNP_WEBHOOK_SECRET` follows the same real pattern.

## Work

`app/api/webhooks/stannp/route.ts` — verifies the HMAC, handles
`mailpiece_status` events, and acts on **only** `status === "cancelled"`:
records it on the matching card's `RecipientResult.providerStatus`
(`lib/postcard/orders.ts`), additive, never touching `ok`/the order's
`built` status. Every other status Stannp reports (`printing`, `dispatched`,
`local_delivery`, `delivered`, `returned`) is acknowledged and dropped —
`app/api/v1/[user]/postcards/[id]/route.ts`'s own module comment already
decided this system will never track delivery, and recording those would
quietly contradict that decision rather than extend it. `cancelled` is the
one status that isn't delivery tracking: it's "this card will never reach
anyone," which the existing decision has nothing to say about.

Not doing, on purpose: refunding the credit a cancelled card cost, or
mailing the owner — filed separately as **B1529**, since it needs its own
design decision (where the refund logic lives) rather than riding along
here. Not doing either: a fixture-driven `docs/testing/coverage.ts` flow —
its `postcards` entry now says the webhook exists and still needs a flow.

## Acceptance

`POST /api/webhooks/stannp` exists, 404s with no `STANNP_WEBHOOK_SECRET`
set and on a bad/missing signature (verified live against a running dev
server, not just the mocked route test), records a cancellation exactly
once and is idempotent on a retried delivery
(`test/orders.test.ts`'s new `findOrderByProviderRef`/
`recordProviderCancellation` describe block, real database), and
`test/stannp-webhook.test.ts` covers the route's own auth/parsing boundary
the way `test/photobook-webhook.test.ts` does for Gelato. `npm run verify`
green.
