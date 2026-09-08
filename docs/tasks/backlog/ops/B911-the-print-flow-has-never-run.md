---
id: B911
title: The print flow has never run against the live site
type: OPS
priority: high
complexity: low
area: photobook, print
found: "2026-09-08T05:23:20Z"
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
