---
id: B757
title: border-navy-300 is used but no navy-300 token exists, so the sign-in field's unfocused border falls back to currentColor
type: ISSUE
priority: low
complexity: low
area: ui, brand
found: "2026-09-07T13:50:27Z"
started: "2026-09-08T21:14:16Z"
merged: "2026-09-08T21:26:30Z"
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

## Resolution

Confirmed still real: `grep -rn "navy-300" app components` before the fix
showed the class used in **41 files**, not just `IdentitySignIn.tsx` — buttons,
inputs, checkboxes and decorative underlines across nearly every screen
(`components/AgentWizard.tsx`, `HelperAsk.tsx`, `DayCosts.tsx`,
`SignupWizard.tsx`, `ConfirmPanel.tsx`, and more), and `app/globals.css`'s
`:root`/`@theme inline` blocks had no `--color-navy-300` at any point in git
history. That breadth is what decided the fix: rewriting 60+ call sites by
hand (or picking `navy-200` for each, which is visibly too light for several
of the non-border uses — `decoration-navy-300` underlines and
`disabled:text-navy-300`) is a bigger, riskier diff than filling the one-line
gap the ramp always had.

Added `--color-navy-300: #aeb7c5` to both the `:root` and `@theme inline`
blocks in `app/globals.css` (one third of the way from `navy-200` (`#d8dee8`)
toward `navy-500` (`#5a6a80`) in linear RGB — there is no existing brand
document naming a `navy-300` value, so this is a mechanically-derived
in-between shade backing the ramp's own three-step gap, not an eyeballed
pick). This backs every existing `navy-300` call site at once with one small,
low-risk change, rather than a 60-occurrence rename.

Added `test/undefined-color-tokens.test.ts`: it walks `app/` and `components/`
for any `<utility>-<hue>-300` class on one of this palette's own hues and
fails if the hue's `-300` token is not defined in `app/globals.css`'s
`:root` block (read via `lib/brand.ts`'s `palette()`, the same source
`/docs/branding/identity` uses). Verified it fails when `--color-navy-300`
is removed (recreated the original bug locally) and passes with it restored.
Scoped to the `-300` shade specifically — see the comment in the test file for
why a broader "every shade" check is not right for this ticket: it turned up
a much larger, differently-shaped pre-existing gap (`navy-800`, undefined
since it was ever added, used in 27 files) that is now captured separately as
B1035, and it also flags shades on Tailwind's own default hue names (`sky`,
`yellow`) that silently fall back to Tailwind's stock colours rather than to
nothing — a design-consistency question, not this bug.

**Acceptance, walked:**
- `getComputedStyle` on the sign-in wrapper: not checked in a real browser —
  no browser session was driven for this change (see note below). The CSS fix
  is unambiguous by inspection: `border-navy-300` on `components/IdentitySignIn.tsx:187,250`
  now resolves against a real `--color-navy-300` hex instead of nothing, so
  the wrapper's unfocused border can no longer render in `currentColor`.
- No undefined `-300` token remains on this palette's hues: enforced by
  `test/undefined-color-tokens.test.ts`, which passes.

**A person's eye is still owed here.** This is a visual change touching ~40
files' worth of borders/underlines/disabled text, and no test can confirm the
computed `#aeb7c5` *looks* right next to `navy-200` and `navy-500` on a real
page — the ticket's own acceptance line asks for a `getComputedStyle` read in
a browser, which was not done. Check `/docs/branding/identity` after this
merges (it renders the ramp live) and spot-check the sign-in page and a
button or two (`check-a-drawing` skill) before considering the visual result
final.

`npm run verify` result: see commit for the full run; `test/task-ids.test.ts`
and any 30s-timeout files are known noise per dispatch instructions and were
re-run alone where relevant.

## Ratified — 2026-09-09

The owner was asked whether `#aeb7c5` should stand, given it was derived
arithmetically (one third from `navy-200` toward `navy-500`) rather than taken
from a brand document that never named a `navy-300`. Their answer: **define it
yourself, that is fine.**

So this is no longer a stopgap awaiting a brand decision — `--color-navy-300:
#aeb7c5` is the shade, and `app/globals.css` is where it lives. The
`apply-the-brand` skill already points at the tokens rather than carrying its
own copy of the hex, so there is nothing to update there and nothing to keep
in step.

The open question this leaves is not this shade but the next one:
`test/undefined-color-tokens.test.ts` covers the `-300` shade on this
palette's own hues. Its own doc comment records that `navy`, `cream` and
`coral` have no Tailwind default to fall back on — so an undefined shade there
is unambiguously this bug — while `sky`, `yellow`, `green` and `blue` share
names with Tailwind's stock palette and would silently resolve to *Tailwind's*
colour instead. That is a different, quieter fault, and B1035 (`navy-800`)
is the one already captured.
