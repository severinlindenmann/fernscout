---
id: B1441
title: Postcard order status only updates when the page is opened
type: FEATURE
priority: low
complexity: medium
area: postcards, mail
found: "2026-09-11T10:37:31Z"
---

# B1441 — Postcard order status only updates when the page is opened

## Why

`lib/postcard/stannp.ts` (`sendPostcard`) makes exactly one call to Stannp —
`POST .../postcards/create` — and stores whatever it returns. Nothing after
that ever asks Stannp again, so a printed order's status on our side is frozen
at whatever it was the moment the owner pressed Send. Stannp's own mailpiece
moves through `producing` → `dispatched` → `local_delivery` → `delivered` (or
`returned`/`cancelled`), and we currently surface none of it — B1439/B1440
already caught the sibling problem for Gelato (nothing reports a printed or
posted book), and postcards have the same gap for a different provider.

The owner wants two moments mailed to them and nothing else pushed: **Order
Created** (already knowable — the synchronous response from `create`) and
**Order Sent**, i.e. the transition into Stannp's `dispatched` status. Every
other status change (`producing`, `local_delivery`, `delivered`, `returned`,
`cancelled`) should just be visible next time they open the order page — no
mail for those.

Stannp supports this as a webhook: register a URL in the Stannp dashboard,
subscribe to `mailpiece_status`, and it POSTs a JSON payload (`mailpieces: [...]`)
on every status change, optionally HMAC-signed (`X-Stannp-Signature`) if a
secret is set. Docs:
https://www.stannp.com/uk/direct-mail-api/webhooks and
https://www.stannp.com/us/direct-mail-api/postcards (`GET
/v1/postcards/get/:id` is the polling alternative — same status vocabulary,
no new inbound route, but means a cron script instead of a push).

## Work

- Add an inbound `POST /api/webhooks/stannp` route (same shape as
  `/api/webhooks/stripe` — verify a signature over the raw body before trusting
  anything in it; see `lib/stripe.ts` for the existing pattern of taking a
  provider's word only once its signature checks out).
- Store the current Stannp status on the postcard order row (wherever
  `paymentRef`/order state already lives for B07's print-order state machine)
  so the order page can show it without calling Stannp itself.
- On a transition into `dispatched`, and only then, send the owner the "Order
  Sent" mail. No mail on `producing`, `local_delivery`, `delivered`,
  `returned` or `cancelled` — those update the stored status silently.
- `STANNP_API_KEY` is already env-only per AGENTS.md; the webhook secret
  (once one is configured in the Stannp dashboard) is a new env var, same
  rule.
- Decide what happens on a webhook for an order we have no row for (reject
  quietly) and on out-of-order delivery (payload for `dispatched` arriving
  after one for `delivered` — Stannp's retry behaviour makes this possible;
  do not regress a further-along status backward).
- Out of scope: Gelato/photobooks' own status reporting is a separate gap
  (B1439/B1440) with a different provider and no webhook support confirmed —
  do not fold it into this ticket.

## Acceptance

- A Stannp `mailpiece_status` webhook call for a known order with a valid
  signature updates that order's stored status.
- An invalid/unsigned webhook call is refused (test the refusal, not just the
  happy path).
- The owner receives exactly one mail when an order first reaches
  `dispatched`, and none for any other status transition.
- The order page reflects the current Stannp status without the owner having
  had to press anything.

## Related

Three tickets extend the same Stannp webhook and should be sequenced as one
piece of work:

- **B1536** is the operator step that makes the route reachable at all — it is
  built and verified locally but has never been registered or given a secret in
  production, so it currently answers 404 to every real delivery.
- **This ticket** is the status-update body and the once-only dispatch mail.
- **B1532** is the refund and notice when the printer reports a cancellation
  after acceptance.

Doing them separately means writing the same signature verification and the
same duplicate-delivery handling two or three times.
