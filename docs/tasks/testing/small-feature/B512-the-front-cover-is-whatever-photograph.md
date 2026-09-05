---
id: B512
title: The front cover is whatever photograph happened to be first
type: FEATURE
priority: medium
complexity: medium
area: photobook, ui
found: "2026-09-05T20:42:56Z"
merged: "2026-09-05T21:19:42Z"
---

# B512 — The front cover is whatever photograph happened to be first

## Why

`planBook` picks the front cover with `chapterBlocks.flat().flatMap(...).at(0)`
(`lib/photobook/plan.ts:1467`) — the first photograph of the first chapter,
which is whatever the first day happened to shoot first.

It is the page seen most and chosen least. It is on the shelf, in the hands of
everyone who picks the book up, and in the photograph somebody takes of the
book to show a friend. Everything else about the book can now be arranged day
by day; the one page a stranger sees is the one nobody has any say over.

The composer already has every photograph in the trip on screen, and B511
already put a star on each for "print this one big". This is the same gesture
one level up.

## Work

`BookOptions.cover?: string` — a `MediaTile.src`, honoured by `coverFor` and
falling back to today's choice when absent or when the photograph is gone, the
same way `hero` does.

In the composer it wants to be a book-level control rather than a seventh
button under every thumbnail: a "cover" section near the format and language,
showing the current front page and offering a picker. Deciding where it lives
is most of this ticket.

**Not doing:** a cover editor. The title, the dates and the spine text are the
trip's and stay the trip's. This chooses which photograph is behind them.

## Acceptance

- A journal can put any photograph in the trip on the front cover.
- A trip nobody has chosen for keeps exactly the cover it has today.
- A chosen photograph that is later deleted falls back rather than printing a
  gap.
