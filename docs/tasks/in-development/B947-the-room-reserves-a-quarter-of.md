---
id: B947
title: The room reserves a quarter of the screen for an empty files pane and never says which day it is previewing
type: FEATURE
priority: medium
complexity: medium
area: helper, ui
found: "2026-09-08T10:45:27Z"
started: "2026-09-08T12:03:35Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-08T12:03:35Z"
---

# B947 — The room reserves a quarter of the screen for an empty files pane and never says which day it is previewing

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

A designer's critique of `/agent/<user>/chat` on a laptop. Four things, in the
order they cost her:

1. **The files pane holds 256px of nothing.** On a journal with an empty inbox
   it shows two lines of muted placeholder and never changes shape — a quarter
   of the width taken from the conversation, which is the pane that matters.
2. **The preview never says which day it is showing.** It opens on "Reading the
   day…", tracks whatever date was last mentioned, and offers no control. A
   first-time reader has no way to know what would make it resolve.
3. **Nothing says where you are.** No trip named above the conversation, no
   list to switch between. Every reference to "the day" lives in the text, and
   there is nothing to click. With several trips this gets confusing quickly.
4. **One toggle, two treatments.** Hiding a pane is a plain text link at `lg`
   and a pill button below it — the same function, drawn two ways, decided by
   breakpoint.

Her own cut: the empty files column, on the layout most likely to be opened on
a laptop.

## Work

1 and 4 are small and independent. 2 and 3 are the same question — the room has
no persistent sense of *what is being talked about* — and are worth designing
together rather than bolting a picker onto the preview.

Not doing: a trip switcher that becomes navigation. Everything is still done by
talking (the user's own rule); this is about knowing where you are while you do
it.

## Acceptance

At 1440px on a journal with an empty inbox, the conversation is wider than it
is today, and the preview names what it is showing. At 390px nothing regresses.
