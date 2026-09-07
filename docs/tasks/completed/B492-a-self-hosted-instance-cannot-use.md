---
id: B492
title: A self-hosted instance cannot use our printing service, so its owner has no way to order a photobook or postcards
type: FEATURE
priority: medium
complexity: high
area: self-hosting, photobook, postcards, billing
found: "2026-09-05T15:47:44Z"
started: "2026-09-06T14:20:16Z"
merged: "2026-09-06T14:35:13Z"
completed: "2026-09-07T13:11:21Z"
---

# B492 — A self-hosted instance cannot use our printing service, so its owner has no way to order a photobook or postcards

## Why

Fernscout is self-hostable, and somebody running it on their own domain gets
everything except the two things that cost money and need an account with a
printer: a photobook and a posted postcard. They can render the PDF —
`lib/photobook/` and `lib/postcard/` build it locally, and the providers have
`dry-run` backends — but there is no route from "I pressed generate" to "it
arrived in the post", because the print credentials and the credits ledger
(`lib/credits.ts`, `lib/payments.ts`) live on the instance the author runs.

So the self-hoster's own button either does nothing useful or asks them to
open a printer account for a single book. Meanwhile the paid path already
exists here and is idle for them.

## Work

- Let a self-hosted instance hand a finished job to a fulfilment instance:
  press generate, get a link, pay there, the job prints and posts. The PDF is
  already print-ready on their side, so the thing crossing the network is an
  artefact and an address, not the trip.
- Decide the money shape first, because it decides everything else. Cheapest
  honest version is a mailed or displayed payment link — no accounts, no API
  keys on the self-hoster's box, and it matches how `POST
  /api/v1/<user>/postcards` already works: an agent proposes, a person opens a
  page and presses one button. The heavier version is an instance key and a
  credits balance, which is `lib/credits.ts` reached over HTTP.
- Addresses stay where they are: cards are addressed by `contactId` from the
  self-hoster's own contacts, and the recipient's address travels only as far
  as the printer. Nothing about this may become a way to post a card to an
  address that arrived in a conversation.
- Also needed and easy to forget: what the self-hoster sees when the fulfilment
  instance is unreachable or refuses, and a way to say "no, print it yourself"
  so the capability being off is absent rather than broken.
- Not doing: reselling anything but our own print providers, and no marketplace.

## Acceptance

On an instance with no printer credentials, generating a photobook produces a
link; opening it on the fulfilment instance shows the preview, the cost and a
pay button; paying prints and posts it. With the capability off, the
self-hosted instance offers only the local PDF and `/api/health` says why.

## Open questions

- Payment link per order, or an instance-level credits balance?
- Who is the customer of record with the printer — us, or the self-hoster?
- Does the PDF upload to us, or do we fetch it from their instance (which
  means their instance must be publicly reachable)?

## Decisions

Answered in full, with reasoning, in
`docs/plans/2026-09-06-fulfilment-relay.md`:

- **A payment link per order**, not an instance-level balance — a balance is
  `lib/credits.ts` reached over HTTP, with a second operator's provisioning,
  top-ups and reconciliation attached; a link needs none of it and matches
  the postcard-proposal shape (`POST /api/v1/<user>/postcards`) already in
  the codebase.
- **The fulfilment instance's operator is the customer of record** with the
  printer — the entire point is that the self-hoster never opens an account.
- **The origin instance uploads the PDF to the fulfilment instance**, never
  the reverse — a self-hosted instance is frequently not publicly reachable,
  often on purpose, and requiring that would defeat the feature for the
  people who most want it.

The spec also settles the protocol shape this implies (job, price computed
by the receiving side, status flowing back honestly, bounded storage) and
names what it deliberately leaves open (admission/abuse control for
`accept`, a real print provider, a real payment gateway).

**Not fully demonstrable in a checkout**, and the spec says why: there is no
second instance to relay to; no print provider is wired on either side
(B435 and its photobook counterpart are prior art, both still open); and
`lib/payments.ts` is a mock ledger everywhere it exists. The Acceptance
line's "it prints and posts" cannot be shown until those land.

## What shipped from this ticket

The capability-honesty slice: `lib/capabilities.ts`'s `dryRunNote()` — a
`postcards`/`photobook` capability that is `enabled: true` on the `dry-run`
provider now carries a `note` saying nothing will actually print, surfaced by
`/api/health`. See `test/capabilities.test.ts`. Everything else is captured:
B588 (superseded by this slice), B589, B590, B591, B592, B593 — see
`docs/plans/2026-09-06-fulfilment-relay.md`'s "Captures" section for what
each does and depends on.
