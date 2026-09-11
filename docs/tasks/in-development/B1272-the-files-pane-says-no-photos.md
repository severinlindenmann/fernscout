---
id: B1272
title: The Files pane says No photos chosen under the three photographs it is showing, and offers no way to remove one
type: ISSUE
priority: medium
complexity: low
area: helper, files
found: "2026-09-10T10:16:18Z"
started: "2026-09-11T04:33:18Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T04:33:18Z"
---

# B1272 — The Files pane says No photos chosen under the three photographs it is showing, and offers no way to remove one

## Why

The helper's **Files** tab, at 390px, immediately after three photographs were
attached and accepted:

> Pick a few, then say what to do with them — "put these on yesterday".
>
> **PHOTOGRAPHS**
> [03.jpg] [02.jpg] [01.jpg]
>
> **PHOTOGRAPHS AND FILES**
> [ Choose files ]
> **No photos chosen**
> Everything you choose waits under **"What is waiting"** — photographs, videos,
> a bank statement, a location export…

Four things go wrong in that half-screen.

**"No photos chosen" sits 80px under three chosen photos.** It is the file
input's own empty state — the input is empty because its files were taken into
the waiting list — but nothing on screen says that, so it reads as a statement
about the page, contradicting the grid directly above it.

**Nothing can be removed.** There is no control on any of the three tiles and no
button in the pane. A photograph attached by mistake — the wrong one from a
camera roll, on a phone, which is where mistakes happen — can only be dealt with
by asking the model in words.

**Two headings, near-identical.** "PHOTOGRAPHS" is what is waiting;
"PHOTOGRAPHS AND FILES" is the control that adds more. Read in order they look
like a list and a larger list.

**The prose names a label that is not on the page.** Files are said to wait under
*"What is waiting"*; the section is headed *PHOTOGRAPHS*. Whatever it was called
when the sentence was written, it is not called that now.

## Work

- The input's empty state should not be shown as a statement about the pane.
  Either drop it or make it say what it means ("nothing new picked yet").
- Give each waiting item a remove control. B862 did exactly this for the day
  gallery's lightbox and its reasoning transfers: the place a person notices
  they do not want a photograph is looking at it.
- Name the two sections for what they are, and make the prose use whichever
  name is on the screen.

## Acceptance

- With files waiting, no text on the pane says nothing is chosen.
- A waiting file can be removed from the pane in one tap.
- Every quoted label in the pane's prose appears on the pane.
