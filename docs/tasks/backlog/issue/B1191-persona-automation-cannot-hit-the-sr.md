---
id: B1191
title: Persona automation cannot hit the sr-only file inputs; confirm real hit areas are whole-tile
type: ISSUE
priority: low
complexity: low
area: helper room
found: "2026-09-09T21:26:17Z"
---

# B1191 — Persona automation cannot hit the sr-only file inputs; confirm real hit areas are whole-tile

## Why

Persona automation (Playwright) could not click the sr-only file inputs in
the room's pane — native clicks were intercepted by the overlay, and the
agent had to click the label text. For a human the label IS the control and
the whole tile toggles, so this is probably an automation artifact, but
nobody has confirmed the hit areas on a real phone: is the entire tile
(image included) inside the label, and is the picker's visible label at
least 44px?

## Work

Check Tile and PhotoPicker markup for whole-surface labels and 44px
targets; fix any gap. Nothing else.

## Acceptance

Every checkbox tile and the picker button toggle from a tap anywhere on
their visible surface at 390px.

## Verified 2026-09-10

Code review: `Tile` (HelperRoom.tsx) and both `InboxFileGroups` tile shapes
wrap the whole visible surface in the `<label>`, `min-h-11`, with
`focus-within` rings; `PhotoPicker`'s visible label is the control. The
persona's failure was Playwright clicking the `sr-only` input directly —
not a path a finger can take. Nothing to change unless a real-device round
disagrees.
