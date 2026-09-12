---
id: B1560
title: On mobile, the chat page scrolls the whole document and the tab bar stops sticking
type: ISSUE
priority: high
complexity: low
area: agent room
found: "2026-09-12T07:26:45Z"
started: "2026-09-12T08:26:57Z"
session: 5a4744c4-0424-4149-9d23-d8a0bd9dd3b1
claimed: "2026-09-12T08:26:57Z"
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

## Still happening after the first fix — reopened 2026-09-12

Reported again, live: the person named the actual trigger — **typing on the
phone's own keyboard** shifts the whole layout, not only a proposal turn
landing. The body-scroll lock and the `scrollIntoView` fix above were both
real bugs and stay fixed, but they were not the whole of it.

The remaining mechanism is different in kind, not just another caller of the
same bug: a mobile on-screen keyboard shrinks the **visual** viewport and
never the **layout** viewport. `h-dvh` (`HelperRoom.tsx:893`) answers for the
layout viewport, so it does not move when the keyboard opens — the room stays
its full pre-keyboard height, now with the keyboard covering the bottom slice
of it. The browser's own keyboard-avoidance behaviour then pans the page to
keep the focused field above the keyboard, and on iOS that pan is a
**visual-viewport offset** (`window.visualViewport.offsetTop`), not a
document scroll — it is the same mechanism pinch-zoom panning uses, and it
does not go through `overflow`, so B1560's `document.body.style.overflow =
"hidden"` (`HelperRoom.tsx:217-223`) does not stop it. That is exactly why the
first fix did not make it go away.

There is prior art for reading this correctly already in this file:
`HelperAsk.tsx:1836-1857` (B1122) tracks `window.visualViewport` to reposition
one button — the proposal card's accept button — while a field on that card
has focus, using `gap = innerHeight - (viewport.height + viewport.offsetTop)`
to tell a real keyboard apart from nothing (a desktop's visual viewport fills
the window, so `gap ≈ 0`). That fix only ever moved one button; the room
itself, including the composer at the very bottom of the main thread, was
never wired to it.

## Work (continued)

- `HelperRoom.tsx` — track `window.visualViewport` the same way B1122 already
  does, but for the whole room: on `resize`/`scroll`, read `viewport.height`
  and `viewport.offsetTop`, and apply them to the outer room element (the one
  currently `h-dvh` at `HelperRoom.tsx:893`) as an explicit pixel `height` and
  `top`, with the element `position: fixed` so it is pinned to the visual
  viewport's own origin rather than the layout viewport's. That makes the
  room's box the actually-visible box at every moment, keyboard included,
  instead of a box the keyboard covers part of — which is what removes the
  browser's own reason to pan the page in the first place: the focused field
  is already inside the (now correctly sized) visible area.
- Keep `h-dvh` as the class default (unchanged for desktop, and correct
  before the effect has measured anything on a phone too), and override with
  the inline pixel values only once `visualViewport` has reported them —
  no `visualViewport` (a browser that lacks it) leaves the room exactly as it
  is today.
- Re-verify against a *phone*, not a resized desktop browser: the visual
  viewport / layout viewport split this bug lives in does not exist on a
  desktop browser at all, keyboard or not — a desktop check cannot fail on
  this even when the fix is wrong. `test-in-a-browser`'s CDP path cannot
  drive a real software keyboard either (Chrome headless has none), so this
  one needs an actual phone or the Chrome DevTools device toolbar with "show
  device frame" and a real focus + typed character, not a screenshot alone.

## Acceptance

- On a phone-width browser, open `/agent`, send a message that ends in a
  proposal (e.g. ask it to publish a day), and confirm the tab bar stays
  pinned to the bottom and the header stays pinned to the top throughout —
  captured with a screenshot before and after the turn lands.
- On an actual phone (or Chrome's device toolbar with a real focus + typed
  character), tap the composer and type: the header stays at the top, the
  tab bar stays immediately above the keyboard rather than off-screen, and
  nothing behind the room becomes visible.
- `npm run verify` passes.
