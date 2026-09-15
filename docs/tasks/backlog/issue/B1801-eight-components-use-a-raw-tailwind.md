---
id: B1801
title: Eight components use a raw Tailwind red for errors where the brand coral belongs
type: ISSUE
priority: medium
complexity: low
area: brand, dark mode
found: "2026-09-15T14:29:15Z"
---

# B1801 — Eight components use a raw Tailwind red for errors where the brand coral belongs

## Why

B1798 gave the dark theme its own green and coral so that text in those hues
clears the contrast floor on navy. It moved one raw `text-red-600` in
`components/extract/UploadStep.tsx` onto the coral token so the fix would reach
it.

About eight other components still use `text-red-700` — raw Tailwind, not a
brand token — as their error colour. Those did not move, because they were
outside that ticket's named scope and changing thirty-five components' worth of
appearance in one pass was already the riskier half of the work.

Two consequences. They do not benefit from B1798's dark values, so each needs
checking on the dark ground in its own right. And the palette now has two ways
to say "something went wrong", which is how a codebase ends up with a red that
drifts from the brand's.

## Work

Find them (`grep -rn "text-red-" components/ app/`) and move each to the coral
token, unless one turns out to mean something coral does not — a genuinely
different signal would be worth keeping distinct and saying so.

Check each on both grounds afterwards. `coral-600` is measured on navy by B1798;
what has not been measured is every surface these particular components sit on,
and a token that clears the page background can still fail inside a tinted panel.

## Acceptance

- No `text-red-*` remains in `components/` or `app/` where an error is meant,
  or the exceptions are named with a reason.
- Each changed line checked on the surface it actually renders on, in both
  themes.

## Related

Follows B1798, which fixed the tokens and the one instance inside the camera-roll
import. Found by the same pass.
