---
id: B897
title: The postcard page throws the whole page away three times in one flow
type: ISSUE
priority: high
complexity: low
area: postcards
found: "2026-09-07T19:02:06Z"
merged: "2026-09-07T19:02:26Z"
completed: "2026-09-09T16:46:37Z"
---

# B897 — The postcard page throws the whole page away three times in one flow

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Reported as "the postcard page feels jumpy when clicking save, and no spinner
or anything to see". Both halves were true and had one cause: three of the
presses on that page were full document navigations.

**Save the back** (`PostcardBack.tsx`) was a plain submit inside the real
`<form method="post">`. B773 made the words autosave on a debounce, and left
the button posting the form — so with JavaScript on, pressing it did a whole
document POST, a redirect and a page load, to save text that had already been
saved 700ms earlier. That is the flash and the jump to the top, and it is also
why B867's spinner was never visible there: the document is gone before a
spinner can turn.

**Both presses of the send flow** were ordinary anchors, so each cost a full
load as well. B850 anchored them to `#send`, which fixed *where* the reader
lands but not the reload.

A fourth thing, found while fixing the first: the button's busy flag cannot be
`state === "saving"`. That state is set on every keystroke, 700ms before
anything is sent, because the status line's promise is that it never saves
silently. Driving the button from it disables the control and flips its label
on every letter typed.

## Work

Done in this ticket:

1. The save button calls the same `fetch` the debounce calls, and the form
   keeps its `action` so JavaScript-off still posts and redirects.
2. A separate `inFlight` flag for the button, distinct from the status line's
   `state`.
3. `Link` rather than `<a>` for the `?confirm=1` step and the way back, so both
   are soft navigations. `?confirm=1` stays in the URL, so B466 is untouched —
   with JavaScript off it is still a server-rendered second step and nothing
   can send on the first click.

**Not doing:** making the confirmation client-only state. B466 is explicit that
the query parameter is what keeps the no-JavaScript path from sending on the
first click, and that reasoning still holds.

**Still a full load:** the send POST itself, which is a real form post on
purpose (B434). One navigation at the end of the flow, landing on `#send`.

## Acceptance

- Pressing Save fires no `beforeunload` and leaves the scroll position alone.
- While typing, the button reads its normal label and stays pressable.
- After pressing, it is disabled with `aria-busy` and a turning spinner.
- With JavaScript disabled, the message form still saves and the send flow
  still takes two presses.
