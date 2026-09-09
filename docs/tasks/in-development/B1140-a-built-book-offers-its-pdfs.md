---
id: B1140
title: A built book offers its PDFs but no way through to the page that prints it
type: ISSUE
priority: high
complexity: low
area: photobook, print
found: "2026-09-09T20:38:00Z"
started: "2026-09-09T18:36:38Z"
session: ce87fdc2-3f66-428c-90d3-ae9d8df84e40
claimed: "2026-09-09T18:36:38Z"
---

# B1140 — A built book offers its PDFs but no way through to the page that prints it

## Why

When a book finishes building, the wizard's done panel
(`app/[user]/(trip)/photobook/PhotobookPageContent.tsx:570`) offers exactly
three things: a link per built PDF, a fallback sentence when the row carries no
files, and "another book". Every one of those links points at
`/<user>/photobooks/<id>/<file>` — the files.

**Nothing links to `/<user>/photobooks/<id>`**, which is the order page: the
print panel, the quote, the recipient and the button that actually prints. Its
URL is a UUID, so the only way to reach it is to be handed the address by an
agent's proposal call or to type it.

Found the direct way: the owner built a book, was told the print panel was
there, and could not find it. The server log shows six visits to the wizard and
one to the order page — reached only after being given the URL by hand.

It also means B1093's own verification was thinner than it read. The panel was
checked by opening the order page directly, which proves the panel renders and
says nothing about whether a person can get to it.

## Work

- Add a link to `/<user>/photobooks/<id>` in the done panel, worded as what it
  does — printing and posting the book — rather than "view order".
- It belongs above "another book": printing the one just built is the more
  likely next step than starting a second.
- Only when `outcome.orderId` is set. The no-files fallback branch still has an
  order id and should carry the link too — that order can be printed even
  though this page cannot link its PDFs.

## Acceptance

- Building a book ends on a panel that offers a way to print it, reachable by
  clicking rather than by typing a UUID.
  **Shown** — `/example/trips/alps-2024/photobook?state=done&order=eae6122c-…`
  renders "Ordered. The files are ready…", the two Download links, then
  **Print and post this book →**, then "Make another book".
  `/tmp/b1145-done/…-1280.png` and its `.json`.
- `npm run verify`. **Green** — all five.

Built alongside B1145 in one branch: they are the same complaint from the two
ends — the owner could not reach the panel, and could not read the address once
they had.
