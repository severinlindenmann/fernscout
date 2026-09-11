---
id: B1438
title: The receipt mail offers three PDFs where the order page offers one
type: CHORE
priority: low
complexity: low
area: photobook, mail
found: "2026-09-11T10:28:29Z"
started: "2026-09-11T10:29:06Z"
session: 96a5b964-fad1-4616-9124-a01eabbd8a46
claimed: "2026-09-11T10:29:06Z"
---

# B1438 — The receipt mail offers three PDFs where the order page offers one

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

B1366 filtered the order page down to the one file a reader wants — `book.pdf`
— and deliberately left the receipt mail alone, on the reasoning that whoever
holds that link might want the print halves. Seen side by side during B911,
that reads as an inconsistency rather than a decision: the page for order
`b911-api-square-soft-36` offers one file and the mail for the same order
offers three.

The mail's own body makes it worse by explaining the single file and then
listing three:

> The whole book is a single PDF with the cover as its first page, which is
> how a printer wants it.
> * Download — book-interior.pdf
> * Download — book-cover.pdf
> * Download — book.pdf

Nobody reading that learns which one to open.

## Work

- `lib/photobook/receipt.ts` ships `built.files` unfiltered; run it through the
  same `visibleBookFiles` helper the page uses (`lib/photobook/visibleFiles.ts`,
  added by B1366) so the two agree and there is one definition of "the files a
  person is offered".
- The interior and cover stay on disk and stay reachable by direct URL, exactly
  as B1366 left them. This is the list in the mail, nothing else.
- Check the sentence above still reads correctly beside a single link.

## Acceptance

- The receipt mail for a single-volume book offers one file, and it is
  `book.pdf`.
- A multi-volume book offers one per volume.
- The page and the mail for the same order list the same files.
- `npm run verify` clean.

---

## Two more, from the owner, 2026-09-11

Both about the same two mails, so they land here rather than in tickets of
their own.

### The receipt says "ready" for a book that is only on its way

Today it opens *"Thank you — your photobook is ready"*. At the moment it is
sent, the book has been built, paid for, and **accepted by Gelato** — the
refusal branch above it already returns early (B1330), so a receipt only ever
follows a successful submission. "Ready" is the wrong word for that: it reads
as finished and in hand, when what has happened is that it has gone to the
printer.

Say that instead: **on the way**. The owner's words were *"thank you, your
photobook is on the way"*.

Note what this does **not** change: the printer can still refuse later. That
is exactly what happened to all six books in the B911 run — Gelato accepted
each order, the receipt went out, and a webhook reported the failure minutes
afterwards, at which point the refusal mail corrected it. Both mails were true
when they were sent, and the new wording keeps that property. Do not reword it
into a promise the webhook can contradict — "on the way" survives a later
refusal being reported; "your book has been printed" would not.

`receipt.ts`'s standing rule still holds and its comment should be updated
rather than deleted: it must not claim the book was **printed or posted**,
because neither has happened. "On the way" is the strongest honest claim.

### Neither mail links to the order page

The receipt carries download links and no route back to the order. The refusal
mail carries a bare reference:

> quote this reference: 64cf5524-348a-407c-9b6c-8e2b7091280a

A reference is what somebody reads out on the phone; a link is what they
click. The order page exists, is owner-only, and shows the printer's own
status — it is the right destination for both mails.

Add a link to `/<user>/photobooks/<id>` to **both**, labelled for what it does
(see this order, or how the printing is going) rather than "click here". Keep
the reference in the refusal mail as well — it is what somebody quotes in a
reply, and the link does not replace it.

## Acceptance, revised

- The receipt for a single-volume book offers one file, `book.pdf`; a
  multi-volume book offers one per volume; page and mail agree.
- The receipt says the book is on its way, not that it is ready, and still
  claims nothing about printing or posting.
- Both mails link to `/<user>/photobooks/<id>`, and the refusal mail still
  carries the reference too.
- `test/photobook-receipt.test.ts` still guards the words, updated for the new
  ones.
- Real German and real Hungarian for any new or changed string, or the English
  in `hu` with a note in this file flagging it for a native read.
- `npm run verify` clean.
