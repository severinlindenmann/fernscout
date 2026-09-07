---
id: B752
title: The sign-in field draws three focus indicators at once, so it reads as a box inside a box
type: ISSUE
priority: medium
complexity: low
area: auth, ui, a11y
found: "2026-09-07T15:30:00Z"
started: "2026-09-07T13:20:25Z"
session: ccdd5120-0eb0-4abf-b76e-a6fd8e5005d8
claimed: "2026-09-07T13:20:25Z"
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
