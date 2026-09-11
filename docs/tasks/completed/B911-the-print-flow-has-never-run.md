---
id: B911
title: The print flow has never run against the live site
type: OPS
priority: high
complexity: low
area: photobook, print
found: "2026-09-08T05:23:20Z"
completed: "2026-09-11T11:54:21Z"
---

# B911 — The print flow has never run against the live site

## Why

On 2026-09-08 the whole chain to Gelato was driven from fernscout.ch: a book
was built and paid for, its signed URL was fetched by Gelato with no cookie,
a `draft` order was accepted, both PDFs were downloaded and preflighted, and
previews came back. The draft was deleted afterwards.

**That draft was posted directly to Gelato, not through this product.** The
in-product path — `POST /api/v1/<user>/photobooks/<id>/print` to propose, then
the owner's own button — has never run against the live site, because the demo
journal has no contact with a postal address, and `bookRecipients` offers only
contacts that are `active` and postable. So `printOrder`'s real order of
operations (claim, spend, submit, refund on refusal) has been exercised by its
tests and by nothing else.

## Work

Against the deployed instance, with `features.photobook.live` still false so
everything Gelato sees is a draft:

- Give the demo journal one contact with a real postal address, through the
  ordinary contacts flow rather than by writing to the database.
- Propose a print with an agent token and confirm the answer is a URL, that
  nothing is charged, and that no street address appears in the response.
- Open that URL as the owner, check the panel shows the print and postage
  split and a credit price, and press the button.
- Confirm: credits moved once, `provider_ref` is set on the row, Gelato holds
  a draft, and the order page reads its status back.
- Press it twice in quick succession and confirm one order and one charge.
- Delete the draft from Gelato afterwards.

Then a hardcover, which has been through no Gelato endpoint at all — only the
200 x 200 softcover has.

## Acceptance

- A `print_orders` row for the demo journal with `provider = 'gelato'` and a
  `provider_ref`, from a button press rather than a curl.
- The findings recorded in `docs/providers/photobook.md`.

---

## The Work above is stale — rewritten 2026-09-11

**Not superseded, and briefly filed as though it were.** B1428 deleted the
route this ticket was written against, which is a fact about the method and
not about the goal. No photobook has ever been printed by this instance;
that is still true, still wanted, and B1428 does not achieve it. A reader
sent to B1428 would find a deletion and no printed book. So this stays open
with its Work section corrected below.

**The premise still holds.** No photobook has ever been printed by this
instance through its own flow. That is still worth proving and this ticket
should stay open.

**The method above no longer exists.** B1428 deleted the propose-then-press
path this ticket was written against: `POST /api/v1/<user>/photobooks/<id>/print`
is gone, `lib/photobook/propose.ts` is gone, and so is the owner's separate
print button. There is nothing left to propose with and no second press to
make. Following steps 2 and 3 as written would fail at the first call.

**What to do instead.** There is one door now, and it is the B1157 one-press
buy: the owner opens the trip's photobook page, builds a book, chooses a
recipient, and presses once. That single press quotes, claims, builds, spends
and submits. So the engagement is shorter than it was:

- Give the demo journal a contact with a real postal address, through the
  ordinary contacts flow. (Already done, per the 2026-09-10 run — check before
  redoing it.)
- Open the trip's photobook page as the owner and buy one book.
- Confirm: credits moved exactly once, `provider_ref` is set on the row,
  Gelato holds the order, and the order page reads its status back.
- Press twice in quick succession and confirm one order and one charge. The
  claim-before-spend ordering is what should make that safe.
- Then a hardcover, which has still never reached any Gelato endpoint.

**And the real blocker is unchanged.** On 2026-09-10 a genuine press did all
of the above and Gelato refused it: *"To be able to place an order please
complete the company information in the portal."* 186 credits were spent and
correctly refunded. Until somebody completes that in Gelato's own portal, this
ticket cannot pass whatever its Work section says.

**One number changed while this sat here.** A book is now priced at twice its
VAT-inclusive landed cost (B1425, B1428), so the 46-page square softcover that
cost 205 credits when this ticket was written now costs 238. Budget the demo
journal's balance accordingly.

---

**Superseded 2026-09-11 by B1428.** The whole flow this task is about testing
— `POST /api/v1/<user>/photobooks/<id>/print` to propose, then the owner's
own button — was deleted whole: nothing outside the demo journal had ever
used it, so B1428 removed `printOrder`, `proposePrint`, both print routes,
and the `print.paid` guard rather than fixing the pricing bug found while
verifying B1425. There is no in-product print flow left of this shape to run
against the live site; the current one-press order button
(`app/[user]/photobook/order/route.ts`) is untested-live for a different
reason and would need its own ticket if that is still wanted.
