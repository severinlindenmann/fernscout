---
id: B1272
title: The Files pane says No photos chosen under the three photographs it is showing, and offers no way to remove one
type: ISSUE
priority: medium
complexity: low
area: helper, files
found: "2026-09-10T10:16:18Z"
started: "2026-09-11T11:12:02Z"
merged: "2026-09-11T18:20:49Z"
completed: "2026-09-11T19:13:22Z"
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

## Parked back here, 2026-09-11

A live owner-session check contradicted the third acceptance line, so this does
not sit in `testing/` looking finished. The pane's note still quotes “What is
waiting”, and nothing on the pane says it.

The other two lines hold: with files waiting nothing claims nothing is chosen,
and every waiting file has a one-tap `×`.

The mechanism for the remaining line was built and is unwired — `PhotoPicker`'s
`noteKey` prop is never passed, because `HelperRoom.tsx:2699` renders
`t("agent.pickAnyFile")` directly. **B1443** carries the evidence in full; fix
it there or here, not in both.

## Fixed here, 2026-09-11 (B1443)

`HelperRoom.tsx`'s files pane now renders its own note,
`t("agent.room.pickAnyFile")`, instead of the standalone inbox page's
`t("agent.pickAnyFile")`. That key already existed in all three locales
(`en`/`de`/`hu`) from the original build — it was written, translated, and
never wired in, which is exactly the shape of the fault: the fix existed and
nothing called it.

`PhotoPicker`'s `noteKey` prop is gone rather than wired. It could not have
been the fix either way: every current caller either renders `bare` (the
room's own `PhotoPicker`) or narrows `accept` away from `PICKER_ACCEPT`
(`EditDay`), and both of those guard the paragraph the prop only ever
customised — so a value passed through it would never have rendered. Deleting
it is the honest version of "delete the prop if nothing will ever pass it":
nothing *could*, not just nothing did.

The standalone `/agent/<user>/inbox` page (`AgentInbox.tsx`) does not use
`PhotoPicker` at all — its `agent.inboxTitle` heading is its own `<h1>`,
quoted nowhere else, and needed no change.

Added `test/helper-room.test.tsx`'s "every quoted label in the files pane's
note appears on the pane — B1443": it reads `dictionary["agent.room.pickAnyFile"]`
straight from the running locale, asserts the pane actually renders that
sentence (catching a room that still says something else), then extracts
every quoted “…” label from it and asserts each is the text of an `h2`/`h3`
in the same rendered subtree. Confirmed it fails on the unfixed code — with
`t("agent.pickAnyFile")` restored it reported the exact live bug: the note
contained “What is waiting”, absent from the pane's real headings
(Photographs, Documents). The shared `FILES` fixture carries no `kind` on its
inbox items, so every item fell into the "Documents" group and the
"Photographs" heading never rendered at all; the new test builds its own
fixture with one `kind: "media"` and one `kind: "files"` entry so both
headings — and both quoted labels — are real.

`npm run verify` (build → tsc → eslint → vitest → knip): all green, 534 test
files / 6979 tests passing, 4 skipped.
