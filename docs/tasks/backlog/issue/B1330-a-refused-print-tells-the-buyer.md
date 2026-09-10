---
id: B1330
title: A refused print tells the buyer their book is being printed
type: ISSUE
priority: high
complexity: low
area: photobook, print
found: "2026-09-10T16:30:00Z"
---

# B1330 — A refused print tells the buyer their book is being printed

## Why

Pressing the button builds the book, charges for it, and hands it to Gelato.
When Gelato refuses, `submitBuiltBook` refunds every credit — and then the
owner is told none of it:

- The page redirects to `state=done`, whose panel reads **"Bestellt. Dein
  Fotobuch wird gedruckt."** over an order the printer rejected.
- The receipt mail goes out unconditionally: *"Danke — dein Fotobuch ist
  fertig"*, with the download links attached, for a purchase that was given
  back.
- Nothing anywhere names the order, so an owner who wants to ask about it can
  only say "my photobook failed", and every order is "my photobook".

The refunds themselves are sound and were verified on three live orders. What
is broken is that a person cannot tell any of this happened.

## Work

- A `print_refused` outcome: the page says the printer would not take it, the
  money is back, and prints the order id — selectable — beside the address to
  write to.
- `outcomeFrom` carries the order id for any outcome that has one, not only
  `done`. It was dropped on the way to the page.
- A separate refusal mail, **with no download links**. The receipt carries the
  PDFs because there is an object on its way; this one carries none, because
  nothing was bought in the end. It says sorry, says the credits are back,
  gives the reference and suggests trying again.
- The receipt is sent only when the book is really going to be printed.

## Acceptance

- A refused order lands on a page that says so and shows its id.
- The refusal mail has no links; the receipt mail is not sent at all.
- A printed order is unchanged — receipt, files, `state=done`.
- `npm run verify`.

## Owner's words

> "it should also give the user back a Feedback, sorry problem with creating
> the photobook, your credits are refunded, contact agent@fernscout.ch with the
> following photobook session id"

and, on the mail:

> "dont send the email before finishing, dont send a pdf if not successfully,
> send a email with sorry it could not print, retry or contact us without pdf"
