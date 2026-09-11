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
