---
id: B1409
title: The chevron on a dropdown jumps from under the label to the right edge when the picker opens
type: ISSUE
priority: medium
complexity: low
area: UI / dropdowns
found: "2026-09-10T19:54:30Z"
---

# B1409 — The chevron on a dropdown jumps from under the label to the right edge when the picker opens

## Why

Reported from the postcard sheet's "Geschrieben auf" language dropdown
(`components/PostcardSheet.tsx:268`), but nothing there is specific to it —
the styling is the one global rule in `app/globals.css:412-496`, so every
`<select>` on the site is the same control.

Closed, the chevron sits **below** the selected word, hard against the left
edge of the box; open, it is up on the same line as the word and against the
**right** edge. So the arrow travels diagonally across the control on every
click, and the box changes height as it goes. It reads as a glitch, and it is
the only moving part of a control that is supposed to be furniture.

The likely cause is the `@supports (appearance: base-select)` branch
(`app/globals.css:437`): under `base-select` the browser lays the button out
itself with a real `::picker-icon` child, and nothing here tells that layout
how to sit — no `display`/`justify-content` on the button, no
`flex-shrink: 0`/`margin-inline-start: auto` on the icon — so the icon wraps
under the label until the open state gives it room. The `@supports not`
branch above draws a background image at `right 0.625rem center` and cannot
have this fault, which is a useful check: a browser without `base-select`
should show the arrow parked correctly in both states.

That is a reading of the CSS, not a measurement — confirm in the browser
before changing anything.

## Work

- Open a page with a `<select>` in Chrome (`base-select` supported) and look
  at the closed and open states; `test-in-a-browser` is the procedure.
- Fix it in the one global rule, not at the call site — twenty-odd selects
  share it, and B1012 already decided that.
- Whatever the fix is, the chevron holds one position in both states and the
  control does not change height when it opens.

## Acceptance

Open any dropdown — the postcard sheet's language picker will do — and the
arrow stays where it was: same line as the selected text, right edge, in both
the closed and the open state. Rotating in place (which the rule at
`app/globals.css:447` already asks for) is the wanted motion; moving is not.
Check at 390px as well as on the desktop.
