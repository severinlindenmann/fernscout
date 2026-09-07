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

## Absorbed B593 (2026-09-07)

B593 was a separate capture — "a fulfilment instance's job intake has no
admission or rate control" — and the owner folded it in here rather than
leaving it to be built afterwards.

**This is a requirement of the route, not a follow-up to it.** A print-job
intake that accepts anything from anyone is an open endpoint that turns another
instance's disk and print budget into a stranger's, so admission and rate
control belong in the first commit that answers a request, not the second:

- **Admission** — the intake must know which instances it will accept jobs
  from, and refuse the rest. Not "authenticated" alone: an address proving who
  it is does not make it welcome.
- **Rate control** — per sending instance, and on bytes as well as job count,
  because one accepted sender can still be a runaway loop.
- The refusals belong in `lib/api/openapi.ts` beside the success, per AGENTS.md.

B593 keeps its file and its id and is filed under `superseded/`.
