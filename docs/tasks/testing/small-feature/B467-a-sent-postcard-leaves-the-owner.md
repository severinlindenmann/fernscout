---
id: B467
title: A sent postcard leaves the owner no record of what was posted
type: FEATURE
priority: medium
complexity: medium
area: postcards, mail
found: "2026-09-05T17:00:20Z"
started: "2026-09-05T13:20:10Z"
merged: "2026-09-05T13:27:21Z"
---

# B467 — A sent postcard leaves the owner no record of what was posted

## Why

Pressing Send spends credits, prints a card and posts it to somebody's house,
and the only trace the owner keeps is a line on a page they will close. The
credit ledger records that fifteen credits went on `postcard` with an order id;
it does not say who it went to or what the card looked like. In a month, "did
I send Marta one from the pass, and which photo was it?" has no answer.

The dry-run provider already writes the print-ready PDF to disk. Mailing it to
the owner costs nothing extra and turns the send into something they can find
again in the place they already keep records.

## Work

- After a successful send, mail the journal's owner a receipt: which day, how
  many cards, **who by name**, what it cost, and the balance left.
- **No postal addresses in the mail.** Names only. The card itself carries the
  address by necessity; a receipt does not, and an inbox is a worse place for
  somebody's street than an encrypted column. This is the constraint to get
  right.
- Attach the rendered card as a PDF — one file, the design as printed.
- Transactional, so **free**: it goes to one person about their own account at
  their own request, which is exactly the rule in `lib/credits.ts`. It must
  not call `spend`.
- Best effort, like `sendInviteMail`: a failed receipt must never make a
  successful send report failure. The cards have already gone.

**The mail layer needs a small extension first.** `lib/mail/rfc822.ts` writes
every attachment as `multipart/related` with
`Content-Disposition: inline` — it was built for the inline photograph a day
letter carries by `cid`. A PDF receipt wants `multipart/mixed` and
`Content-Disposition: attachment`, so `MailAttachment` needs an optional
disposition and the encoder a branch. Keep the existing inline behaviour the
default so no current mail changes shape.

## Acceptance

- A send produces one `.eml` under `content/<user>/mail/` with the PDF
  attached and openable.
- No recipient's street, postcode or country appears anywhere in it — a test
  asserts that against a contact whose address is known.
- Credits do not move for the receipt.
- A transport failure leaves the send reporting success.
- Existing mail with an inline photograph is byte-for-byte unchanged in shape.
