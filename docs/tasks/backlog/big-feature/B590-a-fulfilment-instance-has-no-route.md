---
id: B590
title: A fulfilment instance has no route to accept an uploaded print job
type: FEATURE
priority: medium
complexity: high
area: self-hosting, postcards, photobook
found: "2026-09-06T14:29:03Z"
---

# B590 — A fulfilment instance has no route to accept an uploaded print job

## Why

Per B492's spec (`docs/plans/2026-09-06-fulfilment-relay.md`), a self-hosted
instance with no printer account should be able to hand a finished photobook
or postcard job to an instance that has one. That instance — the
"fulfilment instance" — needs somewhere to receive the job at all. Nothing
today accepts an uploaded PDF plus job metadata from another Fernscout
instance; `lib/postcard/orders.ts` and `lib/photobook/orders.ts` both assume
the artefact is rendered and read locally.

Depends on B589 (the `fulfilment.accept` capability this route gates on).

## Work

An intake route, reachable only when `isEnabled("fulfilment", ..., "accept")`
(or equivalent), that:

- accepts the uploaded artefact(s) — interior + cover for a photobook, the
  four print files for a postcard — and the job metadata the spec names:
  product type, page/card count, trim size, and (postcard only) a shipping
  address, since a relayed job carries the address already resolved from the
  origin's own `contactId` and never a `contactId` this instance could
  resolve itself.
- **prices the job from this instance's own table**, never from anything the
  request supplied — the same discipline `orderCost()` already applies
  locally.
- costs nothing to create and prints nothing (same rule as
  `lib/postcard/orders.ts`'s `createOrder`), answering with an unguessable
  URL on this instance's own domain.
- stores the artefact with a TTL and a sweep for jobs nobody pays for (see
  `ORDER_TTL_MS` for the existing shape) — see B593 for the admission and
  rate-limiting half of this same route, which should land together or
  immediately after.

The payment page itself (preview, price, one button) reuses whatever this
instance's own postcard/photobook payment flow is by the time this is built
— `lib/payments.ts`'s mock ledger today, a real gateway if one exists by
then. **Not doing:** the relay client that calls this route (B591), status
callbacks (B592), or a real print provider (B435 and its photobook
counterpart).

## Acceptance

A test posts a fixture PDF and job metadata at the intake route with
`fulfilment.accept` on and gets back a URL that answers with a preview, a
price computed from this instance's table (not the request), and a pay
button; the same request with `accept` off is refused; an unpaid job older
than its TTL is swept and its artefact deleted.
