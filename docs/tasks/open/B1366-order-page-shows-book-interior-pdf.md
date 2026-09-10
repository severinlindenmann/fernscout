---
id: B1366
title: Order page shows book-interior.pdf and book-cover.pdf links nobody needs
type: CHORE
priority: low
complexity: low
area: photobook
found: "2026-09-10T18:28:01Z"
---

# B1366 — Order page shows book-interior.pdf and book-cover.pdf links nobody needs

## Why

`/<user>/photobooks/<id>` lists three download links per volume —
`book-interior.pdf`, `book-cover.pdf`, `book.pdf` — from
`order.payload.files` (`app/[user]/photobooks/[id]/page.tsx:225-237`, same
list rendered in the trip-page "done" panel,
`PhotobookPageContent.tsx:599-611`). The owner only wants `book.pdf`: the
other two are print-submission halves nobody reading this page has a reason
to open.

**They cannot simply stop being generated**, though, despite the request:
`lib/photobook/build.ts:212-226` writes `-interior.pdf` and `-cover.pdf`
specifically because `lib/photobook/print.ts:254-255` finds files by those
suffixes and submits *those two* to Gelato as the actual print job — `book.pdf`
(the "whole" file, `renderBook`) is written only "for a person to upload to
Gelato by hand," per the comment at `build.ts:216-219`, and is not what an
automated print submission sends. Deleting their generation breaks ordering a
printed book. The real fix is to stop **listing** them on this page, not to
stop building them.

## Work

In `app/[user]/photobooks/[id]/page.tsx` (files list, ~line 225) and
`PhotobookPageContent.tsx` (~line 599-611), filter `files` down to the one
matching `${stem}.pdf}` (i.e. not ending in `-interior.pdf` or `-cover.pdf`)
before rendering the list of links. Leave `build.ts` and `print.ts` exactly as
they are — interior/cover keep being written and keep being what
`submitBuiltBook` sends to the printer; only the owner-facing link list
changes. A multi-volume book (`v1.pdf`, `v2.pdf`, …) should still list one
link per volume, just without each volume's interior/cover pair.

Not touching: file generation, print submission, the `[file]/route.ts`
download route (interior/cover stay downloadable by direct URL for whoever
already has the link, e.g. from the receipt mail — check
`lib/photobook/receipt.ts` for whether the mail should be filtered too, since
it currently ships `built.files` unfiltered as `files`).

## Acceptance

`/<user>/photobooks/<id>` and the trip-page "done" panel list only `book.pdf`
(or `v1.pdf`, `v2.pdf`, … for a multi-volume book) as download links, with no
`-interior.pdf` / `-cover.pdf` entries. Ordering and printing a book still
works — `-interior.pdf` and `-cover.pdf` still exist on disk and are still
submitted to Gelato. `npm run verify` passes.
