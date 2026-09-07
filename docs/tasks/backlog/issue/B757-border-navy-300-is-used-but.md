---
id: B757
title: border-navy-300 is used but no navy-300 token exists, so the sign-in field's unfocused border falls back to currentColor
type: ISSUE
priority: low
complexity: low
area: ui, brand
found: "2026-09-07T13:50:27Z"
---

# B757 — border-navy-300 is used but no navy-300 token exists, so the sign-in field's unfocused border falls back to currentColor

## Why

Found while measuring focus styles for B752. `components/IdentitySignIn.tsx`
gives both fields' wrapper `<div>` a `border border-navy-300`, but
`app/globals.css` never defines `--color-navy-300` — the navy ramp jumps from
`--color-navy-200: #d8dee8` to `--color-navy-500: #5a6a80`. Tailwind cannot
generate a colour for an undefined token, so `border-navy-300` sets
`border-style` and `border-width` but no colour, and the border renders in
`currentColor` — the text colour, `navy-900` (`#1e293b`) — instead of a light
line. A computed-style read on the unfocused wrapper shows `border: 1px solid
rgb(30, 41, 59)`, near-black, where a `navy-300`-ish light grey was clearly
intended (`navy-200` is the hairline colour used everywhere else in this
file, e.g. the panel's own `border-navy-200`).

## Work

Either add `--color-navy-300` to the ramp in `app/globals.css` at a sensible
point between `navy-200` (`#d8dee8`) and `navy-500` (`#5a6a80`), or change
`components/IdentitySignIn.tsx`'s two wrapper `<div>`s to an existing token —
`border-navy-200` is the obvious candidate, since it is what every other
hairline border in this file already uses. Check whether `border-navy-300`
is used anywhere else in `components/` or `app/` before picking either fix,
since a repo-wide grep is one command and this may not be the only place.

## Acceptance

- `getComputedStyle` on the sign-in fields' wrapper shows a real, intended
  border colour (not `currentColor`/text colour) when unfocused.
- No `border-navy-300` (or any other undefined `-300` token) remains, unless
  `--color-navy-300` is added to back it.
