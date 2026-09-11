---
id: B1440
title: Nothing tells the owner their book was printed or posted, or gives them the tracking code
type: FEATURE
priority: medium
complexity: medium
area: photobook, gelato, webhooks
found: "2026-09-11T10:31:23Z"
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
