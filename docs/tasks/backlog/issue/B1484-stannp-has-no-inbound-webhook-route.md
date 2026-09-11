---
id: B1484
title: Stannp has no inbound webhook route, unlike every other print/message provider
type: ISSUE
priority: medium
complexity: medium
area: postcards
found: "2026-09-11T16:35:58Z"
---

# B1484 — Stannp has no inbound webhook route, unlike every other print/message provider

## Why

`app/api/webhooks/` has routes for gelato, stripe, twilio, and whatsapp, but
none for stannp — confirmed by directory listing during the managed-instance
testing-framework plan (docs/superpowers/plans/2026-09-11-managed-instance-testing-framework.md).
`app/api/webhooks/gelato/route.ts` is the shape a Stannp equivalent would
take: a shared-secret header (Stannp offers no signature, same as Gelato),
settling terminal failures and recording tracking/dispatch status, mailing
the owner once. Without it, a postcard order's status can only be checked by
polling Stannp directly (if such a poll exists — check `lib/postcard/orders.ts`
and `lib/postcard/reconcile.ts` for whether one does), and the
managed-instance testing framework has no inbound postcard flow to add to
`docs/testing/coverage.ts` until this ships (see the `postcards` `todo` entry
there).

## Work

Mirror `app/api/webhooks/gelato/route.ts`'s shape for Stannp's own webhook
payload and status vocabulary (check Stannp's API docs for their webhook
event names and shared-secret mechanism — likely a custom header the same
way Gelato's `x-fernscout-webhook` is). Add `STANNP_WEBHOOK_SECRET` to
`lib/capabilities.ts`'s postcards requirement the way `GELATO_WEBHOOK_SECRET`
would need to be (check it is not already silently expected somewhere).

Not doing: building a fixture-driven flow for it yet — that is
`docs/testing/coverage.ts`'s `postcards` entry, updated once this route
exists.

## Acceptance

A `POST /api/webhooks/stannp` route exists, refuses an unauthenticated
delivery the way `app/api/webhooks/gelato/route.ts` does, and
`test/openapi-contract.test.ts` / the equivalent webhook test coverage passes.
