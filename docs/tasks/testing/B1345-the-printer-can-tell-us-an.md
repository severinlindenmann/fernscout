---
id: B1345
title: The printer can tell us an order failed, and nothing is listening
type: FEATURE
priority: high
complexity: medium
area: photobook, print, webhooks
found: "2026-09-10T19:20:00Z"
merged: "2026-09-10T17:15:27Z"
---

# B1345 — The printer can tell us an order failed, and nothing is listening

## Why

B1336's last open line. Gelato accepts a create immediately and decides
separately whether it will actually print; the gap measured on this instance
was **62 seconds**, and there is no reason it could not be an hour. The
five-minute sweep closes that from our end by asking. Gelato will simply tell
us — it posts `order_status_updated` to any URL you give it — and nothing was
listening.

The difference is not academic: it is whether somebody is refunded while they
are still looking at the page, or after they have gone to bed.

## What shapes the design

**Gelato does not sign its webhooks.** Stripe signs, and
`app/api/webhooks/stripe/route.ts` verifies that signature over the raw body.
Gelato offers a custom header of your choosing instead, so the header *is* the
credential and the route has to treat it as one:

- No `GELATO_WEBHOOK_SECRET`, no route — 404 for everybody, the way a
  capability that is off is absent rather than broken. An endpoint that
  returns money is not something to leave open while somebody gets round to
  configuring it.
- Compared with `timingSafeEqual`, over SHA-256 of each side so the lengths
  match — that function throws on a length mismatch, and the throw is itself
  an oracle for how long the secret is.
- 404 and not 401 on a bad secret. A 401 tells whoever is knocking that they
  found the right address.

## What it acts on

Terminal failures only — `failed`, `canceled`, `cancelled`. Every other status
Gelato sends, now or in a year, is an acknowledged no-op. Refunding on
`in_production` would be giving money back for a book that is in the post.

Only `order_status_updated`; the item-level event describes a line rather than
an order, and a one-item photobook would otherwise be settled twice for the
same news.

Always 200 once the caller is authentic. A webhook that answers 500 is retried
for hours, and none of the reasons not to act — an unknown order, an ignored
status, one already settled — is a reason to try again.

## Shared with the sweep

`settleRefusedPrint` is now the one definition of settling: money back, order
marked failed, owner mailed without download links. The sweep finds these by
asking and the webhook is told; neither may have its own idea of what it
means. It re-reads the row and only settles one out of `print_submitted`, so
a webhook and a sweep arriving seconds apart — or Gelato retrying — refunds
once.

## Acceptance

- With no secret set, the route is a 404.
- A wrong, empty, missing, or prefix-of-the-real secret is a 404 and settles
  nothing.
- A terminal failure settles the order; every healthy status does not.
- `npm run verify`.

## Needs the operator

Gelato's dashboard is not something an agent can reach. See the deploy note in
the summary: generate the secret, put it in `/etc/fernscout/env`, and add the
webhook in Gelato with the matching header.
