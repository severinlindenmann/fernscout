---
id: B591
title: A self-hosted instance has no way to relay a print job to a fulfilment instance
type: FEATURE
priority: medium
complexity: high
area: self-hosting, postcards, photobook
found: "2026-09-06T14:29:08Z"
wontDo: Part of the fulfilment relay chain, which is not being built. See B590.
---

# B591 — A self-hosted instance has no way to relay a print job to a fulfilment instance

## Why

An instance with no printer credentials can already render a print-ready PDF
locally (`lib/postcard/render.ts`, `lib/photobook/build.ts`), but has nowhere
to send it. B492's spec (`docs/plans/2026-09-06-fulfilment-relay.md`) settles
that it should upload the artefact to a configured fulfilment instance (never
the other way — a self-hosted instance is frequently not publicly reachable,
which is often the whole reason it is self-hosted) and get back a link to
hand to the owner. Nothing today does that upload.

Depends on B589 (`fulfilment.relay`) and, to be testable end-to-end, B590 (the
route on the other end).

## Work

When `sendOrder` (postcards) or its photobook equivalent would otherwise need
a real provider it does not have, and `fulfilment.relay` is on: instead of
`handToProvider` failing closed, render as today, upload the artefact plus
job metadata to the configured fulfilment instance, and surface the returned
URL exactly as `POST /api/v1/<user>/postcards` already surfaces a preview
link — to the owner's own page, **never to the agent as a completed order**.
The address for a postcard is resolved from this instance's own `contactId`
and travels only as far as the upload, per the existing rule in
`lib/postcard/orders.ts`'s module comment.

**Not doing:** the intake route (B590), status flowing back (B592), or
choosing/building a real payment gateway.

## Acceptance

With `fulfilment.relay` on and pointed at a (possibly fixture/mock) fulfilment
endpoint, generating a postcard or photobook with no real local provider
configured produces a link rather than a `provider_unavailable` failure; the
address for a postcard recipient is never logged or returned to any caller
authenticated as an agent token.
