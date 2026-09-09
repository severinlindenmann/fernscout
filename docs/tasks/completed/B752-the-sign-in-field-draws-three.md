---
id: B752
title: The sign-in field draws three focus indicators at once, so it reads as a box inside a box
type: ISSUE
priority: medium
complexity: low
area: auth, ui, a11y
found: "2026-09-07T15:30:00Z"
started: "2026-09-07T13:20:25Z"
merged: "2026-09-07T13:56:01Z"
completed: "2026-09-09T16:47:27Z"
---

# B752 — The sign-in field draws three focus indicators at once, so it reads as a box inside a box

## Why

The owner: *"the sign in to enter mail feels a bit buggy or unfinished, this
border around it is strange."* It is not taste — it is three focus rings
painted on top of each other, measured in a real browser on `/agent` with the
email input focused:

| Element | What it draws |
| --- | --- |
| wrapper `<div>` | `border: 1px rgb(47,111,237)` — `focus-within:border-blue-500` |
| wrapper `<div>` | `box-shadow 0 0 0 2px rgb(47,111,237)` — `focus-within:ring-2` |
| the `<input>` itself | `outline: 2px solid rgb(47,111,237)` |

The third one is the surprise, because `components/IdentitySignIn.tsx:132`
already says `focus:outline-none focus:ring-0` on the input. That utility
matches `:focus`; `app/globals.css:264` sets `:focus-visible { outline: 2px
solid var(--color-blue-500); outline-offset: 2px }` on every element, and a
keyboard or caret focus matches `:focus-visible` too. So the global rule still
applies and the input paints its own outline **inside** the wrapper that is
already showing focus — which is exactly the inner rounded rectangle in the
screenshot.

The doubling on the wrapper is the second fault: `focus-within:border-blue-500`
and `focus-within:ring-2` together give a 1px line and a 2px ring with nothing
between them, so even without the input's outline it reads as a thick smeared
band rather than one deliberate edge.

This is worth fixing carefully rather than by deleting outlines: the global
`:focus-visible` rule is a real accessibility guarantee and must keep working
everywhere else. Only the input that sits inside a wrapper *already showing
its focus* should be quiet.

## Work

- One indicator, on the element a person perceives as the control — the
  wrapper. Keep either the border change or the ring, not both.
- Silence the inner input's own outline with `focus-visible:outline-none`
  (not just `focus:`), so it beats the global rule for this case only. Leave
  `app/globals.css:264` alone.
- The same wrapper markup is used twice in this file — the email field and the
  six-digit code field. Fix both; they have the same bug.
- The disabled "Send me a code" button reads as washed-out yellow at
  `opacity-50`. Disabled controls are exempt from contrast rules, but check it
  still looks deliberate rather than broken.

## Acceptance

- Focusing either field with a keyboard shows exactly one blue indicator.
- Focus is still clearly visible on both fields, and everywhere else on the
  site is unchanged.
- Verified by reading computed styles in a browser, not by eye.

## Done

Fixed in `components/IdentitySignIn.tsx` (both wrapper `<div>`s, email and
code) and `app/globals.css`.

- Dropped `focus-within:border-blue-500` from both wrappers — the ring
  (`focus-within:ring-2 focus-within:ring-blue-500`) is now the wrapper's
  only focus indicator.
- **The input's own outline turned out not to be fixable with a Tailwind
  utility at all.** `focus-visible:outline-none` lives in Tailwind's
  `@layer utilities`; `app/globals.css:264`'s `:focus-visible` rule is
  unlayered CSS, and an unlayered rule always beats a layered one regardless
  of specificity or source order — so the utility silently never won,
  measured or not. Added a new, separately-unlayered rule instead, right
  after the block at :264 (left untouched, as asked):
  ```css
  .quiet-inner-focus:focus-visible {
    outline: none;
  }
  ```
  and applied `.quiet-inner-focus` to both `<input>`s. Being unlayered and
  more specific than the bare `:focus-visible` pseudo-class, it wins.

Verified by reading computed styles in a real browser (Playwright, Chrome for
Testing), on `/agent` signed out:

**Email field, focused:**
- wrapper: `box-shadow: rgb(47, 111, 237) 0px 0px 0px 2px` (the ring), `border:
  1px solid rgb(30, 41, 59)` (unchanged by focus)
- input: `outline: rgb(30, 41, 59) none 3px` — style `none`, i.e. nothing
  painted

**Code field, focused:** identical shape — one ring on the wrapper, `outline:
… none …` on the input.

So: exactly one blue indicator per field, confirmed by computed style, not by
eye. Screenshot: the email field at focus shows a single clean ring with no
inner rectangle.

**Found in passing, not fixed here (kept out of scope, filed as B757):** the
wrapper's own unfocused border is `border-navy-300`, and no `--color-navy-300`
token exists in `app/globals.css` — the ramp jumps from `navy-200` to
`navy-500`. Tailwind can't colour an undefined token, so the border renders in
`currentColor` (`navy-900`, near-black) instead of a light line. Pre-existing
(present since B733, unrelated to the three-outline bug), not part of this
ticket's acceptance, so left alone and captured separately.
