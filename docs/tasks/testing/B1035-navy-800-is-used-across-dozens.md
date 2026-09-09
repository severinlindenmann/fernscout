---
id: B1035
title: navy-800 is used across dozens of components but no navy-800 token exists
type: ISSUE
priority: medium
complexity: low
area: ui, brand
found: "2026-09-08T21:20:34Z"
started: "2026-09-09T06:09:12Z"
merged: "2026-09-09T18:03:33Z"
---

# B1035 — navy-800 is used across dozens of components but no navy-800 token exists

## Why

Found while fixing B757 (`border-navy-300` with no `--color-navy-300` behind
it). A repo-wide grep for the same shape turns up a much bigger instance of
it: `text-navy-800` / `bg-navy-800` / `border-navy-800` / `ring-navy-800` /
`outline-navy-800` appear across 27 files in `app/` and `components/`
(`components/HelperRoom.tsx`, `components/AgentWizard.tsx`,
`components/DayCosts.tsx`, most of `app/[user]/(trip)/photobook/`, and more —
run `grep -rln "navy-800" app components` for the current list), and
`app/globals.css` never defines `--color-navy-800`. The ramp only has
`navy-900`, `navy-700`, `navy-600`, `navy-500` and (since B757) `navy-300`,
`navy-200` — no `navy-800` at any point in its history (`git log --all -p --
app/globals.css` shows it was never there).

Unlike `border-navy-300`, most of these are single-purpose `text-navy-800`
classes (semibold labels, links, headings), so the failure mode is probably
different from B757's: Tailwind likely emits no rule at all for an
unresolvable `text-*` utility, so the element keeps whatever colour it
inherits from its ancestor — which in most of these components is already a
dark navy (`body`'s `--foreground: var(--color-navy-900)`), so the visible
difference from the intended `navy-800` may be small or none. That needs
checking rather than assuming; a handful of spots (`components/HelperRoom.tsx`
uses `bg-navy-800`, `border-navy-800`, `ring-navy-800`, `outline-navy-800` as
an active/selected state, and `components/PushInstallOnboarding.tsx` uses
`hover:bg-navy-800`) are compound utilities more like B757's border case and
more likely to be visibly wrong.

## Work

Decide, the same way B757 did: either add `--color-navy-800` to the ramp at a
sensible point between `navy-900` (`#1e293b`) and `navy-700` (`#3a4a63`) — it
would need to sit very close to `navy-900`, since 700/800/900 are compressed
together in that end of this custom (non-linear) ramp — or replace the 27
files' `navy-800` with the token actually intended (`navy-900` is the likely
candidate for headings/labels, matching the ramp's own documented job list in
`app/globals.css`'s comment). Check `getComputedStyle` on a few of the
`HelperRoom.tsx` selected-state elements specifically, since those are the
ones most likely to be visibly broken today. `test/undefined-color-tokens.test.ts`
(added in B757) only checks the `-300` shade on purpose — extend it, or add a
sibling assertion, once this is resolved, so a `navy-800` regression fails
the same way.

## Acceptance

- `getComputedStyle` on a `navy-800` element (e.g. the selected file in
  `components/HelperRoom.tsx`) shows a real, intended colour rather than an
  inherited one that happens to look similar.
- No `navy-800` (or any other undefined shade on this palette's own hues)
  remains, unless the corresponding `--color-*` token is added to back it.
