---
id: B515
title: There is no way back from an arrangement you regret
type: FEATURE
priority: medium
complexity: low
area: photobook, ui
found: "2026-09-05T20:42:57Z"
started: "2026-09-05T20:47:26Z"
merged: "2026-09-05T21:19:42Z"
---

# B515 — There is no way back from an arrangement you regret

## Why

B504 and B511 gave the composer six layouts, photo selection, a hero star and
reordering, and no way to undo any of it. An arrangement lives in
`localStorage` and the only way out is the browser's developer tools.

Somebody who has fiddled with a day and made it worse — which is most people,
most of the time, on the way to making it better — cannot get back to the
version the book chose. That makes trying things expensive, and a tool where
experimenting is expensive is one people stop experimenting with.

## Work

Two controls. A day that has been arranged gets "let the book decide again",
which deletes its entry. The book gets the same at the top, which empties
`days` and clears the stored arrangement.

Say what will be lost before doing the second one — eighteen days of choices is
an evening, and a confirmation is cheaper than the evening.

**Not doing:** undo history. A stack of states is a different feature and this
is the one that stops somebody being stuck.

## Acceptance

- A day returns to the planner's arrangement in one action, and the summary row
  stops claiming it was arranged.
- The whole book returns to its default, after saying what that will discard.
