---
id: B1560
title: On mobile, the chat page scrolls the whole document and the tab bar stops sticking
type: ISSUE
priority: high
complexity: low
area: agent room
found: "2026-09-12T07:26:45Z"
started: "2026-09-12T07:27:19Z"
session: 5a4744c4-0424-4149-9d23-d8a0bd9dd3b1
claimed: "2026-09-12T07:27:19Z"
---

# B1560 — On mobile, the chat page scrolls the whole document and the tab bar stops sticking

## Why

Reported directly: on a phone, while the helper is answering or a turn ends in
something like a send/publish confirmation, the bottom tab bar stops sticking
and the whole page scrolls down to empty space below the room.

`HelperRoom.tsx:874` builds the room as `h-dvh`, with the header and the
mobile tab bar (`HelperRoom.tsx:1297-1299`) as ordinary flex `shrink-0`
siblings in that column — neither is `position: fixed`. That is fine as long
as `<html>`/`<body>` never scroll, because the room already is the whole
viewport. But `app/globals.css` puts no `overflow` or height constraint on
`html`/`body` (checked: only `scroll-padding-top` on `html`, background/color/
font on `body`), so nothing stops the *document* from scrolling if anything
ever moves `window.scrollY` off zero. Once that happens, the header and tab
bar — ordinary content, not fixed — scroll away with everything else, and
since the room's content is exactly `h-dvh` tall, scrolling past 0 reveals
bare `<body>` background below it: exactly "scrolls out to an empty page".

The trigger is `HelperAsk.tsx:653`:
```
turnTop.current?.scrollIntoView?.({ block: "start" });
```
This fires whenever a turn ends in a proposal (a send/publish/confirm card —
squarely "the chat is sending stuff"). `turnTop` sits inside `log`
(`HelperAsk.tsx:1096`), the thread's own `overflow-y-auto` scroll box.
`scrollIntoView` walks every scrollable ancestor to satisfy the request,
including the window itself if this room's own layout is a pixel taller than
the visual viewport at that moment (a `dvh` mismatch during a mobile browser
chrome/keyboard transition is exactly the kind of moment this happens in) —
at which point the browser scrolls `window`, and there is nothing set up to
stop or reset that.

This exact class of bug has one prior fix on file already:
`GamePath.tsx:153-156` documents choosing a manual `scroller.scrollTo`
over `scrollIntoView` for precisely this reason — "`scrollIntoView` would
also scroll every ancestor — including the window — which fought the reader
for control of the page". `HelperAsk`'s own bottom-of-thread effect
(`HelperAsk.tsx:657`, `log.current.scrollTop = log.current.scrollHeight`)
already does it the safe way; the proposal branch two lines above it does
not.

## Work

- `HelperAsk.tsx:653` — replace the `scrollIntoView` call with a manual
  `log.current.scrollTop = …` computation that brings `turnTop` to the top of
  the `log` box only (mirroring `GamePath.tsx:153-166`), so a proposal turn
  can never reach past `log` to scroll the document.
- Root-cause guard, not just the one trigger: while the room
  (`HelperRoom.tsx`) is mounted, lock `document.body.style.overflow = "hidden"`
  for its lifetime, the same pattern already used in
  `SlideShow.tsx:227-229/253-254` for a full-screen overlay. The room is meant
  to be the whole viewport already (`h-dvh`); this makes that true structurally
  instead of by convention, so no future stray scroll — this one, a keyboard
  transition, a `dvh` rounding edge — can ever carry the header/tab bar off
  screen with it.

Not doing: rewriting the whole layout to real `position: fixed` header/footer.
The flex-column `h-dvh` shape already works when the document itself cannot
scroll; locking body scroll is the smaller fix and matches the codebase's
existing convention for this exact situation.

## Acceptance

- On a phone-width browser, open `/agent`, send a message that ends in a
  proposal (e.g. ask it to publish a day), and confirm the tab bar stays
  pinned to the bottom and the header stays pinned to the top throughout —
  captured with a screenshot before and after the turn lands.
- `npm run verify` passes.
