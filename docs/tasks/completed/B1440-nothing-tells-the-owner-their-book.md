---
id: B1440
title: Nothing tells the owner their book was printed or posted, or gives them the tracking code
type: FEATURE
priority: medium
complexity: medium
area: photobook, gelato, webhooks
found: "2026-09-11T10:31:23Z"
started: "2026-09-11T11:02:10Z"
merged: "2026-09-11T11:25:01Z"
---

# B1440 — Nothing tells the owner their book was printed or posted, or gives them the tracking code

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Today the Gelato webhook settles **terminal failures only**. Its own comment
says so, and says why:

> Every other status Gelato sends, now or in a year, is an acknowledged no-op:
> `created`, `passed`, `in_production`, `printed`, `shipped`. A webhook is not
> a licence to act on a word we have not thought about.

That caution was right when nothing downstream was ready for those words. The
consequence is that the two moments a buyer actually cares about pass in
silence: the book is printed, and the book is posted. The owner's last word
from Fernscout is "on the way" (B1438), and then nothing, ever — even though
Gelato tells us.

Gelato also offers a **Tracking code** event, which is the single most useful
thing a person can be given about a parcel, and we neither subscribe to it nor
have anywhere to put it.

Proven in the B911 run on 2026-09-11: six orders, webhooks arriving and
signature-verified, `order_status_updated` handled — and the only status ever
acted on was `failed`.

## Work

**Get the payload shapes first.** The owner can supply real example events for
each type; do not guess field names. Gelato's event list offers at least: Item
status, Tracking code, Order status. Subscribe to the ones needed and write
down the observed shape in `docs/providers/photobook.md` beside the existing
notes, because a shape guessed from documentation is how the `itemReferenceId`
bug (B1125) happened.

Then:

- Store the tracking code and carrier on the order when the tracking event
  arrives.
- Act on `printed` and `shipped`: move the order's own state forward and tell
  the owner. Two mails at most — do not narrate every intermediate status.
  "It has been printed" is arguably not worth a mail on its own; "it is in the
  post, here is the tracking" certainly is. **A person should decide how many
  mails a book is worth** — propose one (posted, with tracking) and ask.
- Show it on the order page, which is where somebody goes to look: the
  printer's own status is already there, so the tracking code belongs beside
  it as a link where the carrier offers one.
- Keep the safety property the comment describes: an unknown status stays an
  acknowledged no-op, and nothing new refunds anything.
- Idempotent, like the existing handler — Gelato retries, and a tracking event
  may arrive twice.

**Depends on B1437**, which frees the word `printed` as an order status by
renaming the current "built" meaning. A book Gelato has actually printed is
the first thing that deserves to be called `printed`.

**Not in this ticket.** No change to refunds or to the failure path.

## Acceptance

- A tracking code from Gelato is stored, shown on the order page, and reaches
  the owner.
- `printed` and `shipped` are acted on rather than ignored, and the order's
  state says which has happened.
- An unrecognised status is still an acknowledged no-op.
- Delivering the same event twice changes nothing the second time.
- The observed payload shape for each subscribed event is written down in
  `docs/providers/photobook.md`.
- `npm run verify` clean.

---

## The real payloads, supplied by the owner 2026-09-11

No longer guesswork. Three events, with our own current response beside each —
which is itself the record of what we ignore today.

**1. `order_item_status_updated`** — per item, the preflight/production step.

```json
{ "id": "is_5b6403bd3cf1f", "event": "order_item_status_updated",
  "itemReferenceId": "…", "orderReferenceId": "…",
  "orderId": "e82885f8-…", "storeId": null,
  "fulfillmentCountry": "US", "fulfillmentStateProvince": "NY",
  "fulfillmentFacilityId": "21315db8-…",
  "status": "passed", "comment": null, "created": "2018-08-03T07:26:52+00:00" }
```
We answer `{"ok":{},"ignored":"event"}` — the handler only reads
`order_status_updated`.

**2. `order_item_tracking_code_updated`** — the one that carries the parcel.

```json
{ "id": "tc_5b6403bd3cf2e", "event": "order_item_tracking_code_updated",
  "orderId": "a6a1f9ce-…", "storeId": "84086be9-…",
  "itemReferenceId": "…", "orderReferenceId": "…",
  "trackingCode": "code123",
  "trackingUrl": "http://example.com/tracking?code=code123",
  "shipmentMethodName": "DHL Express Domestic BR",
  "shipmentMethodUid": "dhl_express_domestic_br",
  "productionCountry": "BR", "productionStateProvince": "SP",
  "productionFacilityId": "940fec84-…", "created": "2018-08-03T12:11:30+00:00" }
```
Also `{"ok":{},"ignored":"event"}`.

**3. `order_status_updated`** with `fulfillmentStatus: "shipped"` — and it
carries the tracking too, nested.

```json
{ "id": "os_5e5680ce494f6", "event": "order_status_updated",
  "orderId": "a6a1f9ce-…", "storeId": null, "orderReferenceId": "…",
  "fulfillmentStatus": "shipped",
  "items": [ { "itemReferenceId": "…", "fulfillmentStatus": "shipped",
    "fulfillments": [
      { "trackingCode": "code123", "trackingUrl": "…",
        "shipmentMethodName": "DHL Express Domestic BR",
        "shipmentMethodUid": "dhl_express_domestic_br",
        "fulfillmentCountry": "BR", "fulfillmentStateProvince": "SP",
        "fulfillmentFacilityId": "940fec84-…" },
      { "trackingCode": "code234", "…": "…" } ] } ] }
```
We answered `{"ok":{},"ignored":"reference"}` — **only** because
`orderReferenceId` was the literal `{{MyOrderId}}` placeholder and failed
`ORDER_ID_RE` (route.ts:143). For a real order this event *is* read, and then
dropped at `isTerminalFailure` (`:146`). So this is the event to build on and
the join key is `orderReferenceId`, which is our own order id.

### Four things these payloads settle

- **Tracking arrives by two routes**, the dedicated event and nested inside
  `order_status_updated`. Handle at least the nested one, since it comes with
  the status that matters; handling both is cheap and Gelato's ordering is not
  guaranteed.
- **`fulfillments` is an array and the example has two codes for one item.**
  A book can ship in more than one parcel. Do not write this as a single
  `trackingCode` column and do not show only the first.
- **`orderId` is Gelato's id — our `provider_ref`** — and `orderReferenceId`
  is ours. Two ids, and the handler already keys on the right one.
- **`order_item_status_updated` is per item.** A photobook order is one item,
  so it adds nothing `order_status_updated` does not already say. Skip it
  unless a reason appears; fewer subscriptions is fewer half-handled words.

### The proposal, unless the owner says otherwise

**One mail, not three.** `shipped` earns one — it is the moment a person can
act on something, and it carries the tracking. `printed` and `in_production`
update the order page and send nothing; a mail for every hop is how a useful
sender becomes one that gets filtered. If a mail for "it has been printed" is
wanted, say so and it is a small addition.

`passed` stays an acknowledged no-op, as does anything unrecognised.

---

## Decided 2026-09-11 — one mail, on shipped

The owner's word: **one mail when shipped.** So:

- `shipped` → store the tracking, move the order's own record forward, and
  send **one** mail carrying the tracking code and its link.
- `printed`, `in_production`, `passed`, `created` → update what the order page
  can show, send nothing.
- Anything unrecognised → acknowledged no-op, exactly as today.

### Where the data goes, given how the page already works

`app/[user]/photobooks/[id]/page.tsx` calls `fetchOrderStatus(providerRef)`
**live on every render** — that is where "The printer's own status: created"
comes from. So the printer's *status* needs no storing.

Tracking is different and must be stored: it arrives by webhook, the mail has
to quote it, and a live status fetch is not guaranteed to carry it. Add to the
`print` block in `PhotobookPayload` (`lib/photobook/orders.ts:59`):

```ts
/** B1440. Every parcel Gelato reports for this order. An item can ship in
 *  more than one — the observed payload carries two — so this is a list and
 *  the page shows all of them. */
tracking?: { code: string; url?: string; carrier?: string }[];
shippedAt?: string;
```

Append rather than replace when a second tracking event arrives, and
de-duplicate on `code` so a retried delivery does not double the list.

### Do not move the row's `status`

B1437 freed the word `printed`, but leave the column alone here. `built` is
what makes a refused order retryable (`submitBuiltBook` checks
`order.status !== "built"`) and it is what `troubles()` scans for B1165. A
book's journey at the printer belongs in `payload.print`, which is already
where `providerRef` and `failure` live. Introducing a terminal row status is a
separate decision with a blast radius across retry and /admin, and nothing
here needs it.

### The mail

One new sender beside `sendPhotobookReceipt` and `sendPhotobookRefused` in
`lib/photobook/receipt.ts`, following their shape exactly: best-effort, never
throws, links to the order page (B1438 just added that to both others).

It may say the book has been **posted**, because by then it has — that is the
first moment any mail from this system is allowed to say so, and
`receipt.ts`'s standing rule about not claiming a book was printed or posted
needs its comment updated to name this one exception rather than being
quietly contradicted.

Real English and German; `hu` may carry English with a note here, as B1438 did.

**Note:** `hu` carries the same English text as `en` for the new
`photobook.shipped.*` and `photobook.print.tracking*` keys — no Hungarian
speaker available in this session.

## Acceptance, revised

- A `shipped` event stores every tracking code it carries, shows them on the
  order page with their links, and sends exactly one mail.
- Two tracking codes in one event produce two entries, not one.
- The same event delivered twice sends one mail and stores one copy.
- `printed` and `in_production` change the page and send nothing.
- An unrecognised status is still an acknowledged no-op, and nothing new
  refunds anything.
- The observed payload shapes are written into `docs/providers/photobook.md`.
- `npm run verify` clean.
