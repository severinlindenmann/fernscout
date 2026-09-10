---
id: B1325
title: The hero buttons stack on desktop and the agent page changes colour below the fold
type: ISSUE
priority: medium
complexity: low
area: landing, agent, design
found: "2026-09-10T15:55:16Z"
merged: "2026-09-10T16:10:21Z"
---

# B1325 — The hero buttons stack on desktop and the agent page changes colour below the fold

## Why

Two small visual faults from B1314/B1310, `components/LandingSections.tsx`
and `components/AgentDoor.tsx`:

1. `LandingHero` (`components/LandingSections.tsx:312`) rendered "Start
   writing →" and the WhatsApp button as two independent siblings, each only
   `sm:w-auto` on itself, with no shared row container — so even above the
   `sm` breakpoint, where there is width to spare, they stacked one above the
   other with the full-width "oder" divider between them, wasting the
   horizontal space a desktop visitor has.
2. `AgentDoor.tsx:108` wrapped the door's whole cream-100 background in
   `min-h-full`, which resolves against the ancestor chain's own height.
   Neither `html` nor `body` sets an explicit height, so on short content
   (signed out, `signup` off) the div stopped at its content's height rather
   than the viewport, and `body`'s own background (`--background`, cream-50)
   showed through below it — a second, slightly different cream than the one
   the door content sits on.

## Work

- `OrDivider` (`LandingSections.tsx`) took an optional `compact` prop that
  drops its hairlines from `sm` up, leaving just the inline "oder" word — used
  only by `LandingHero`'s call so `AgentDoor`'s own stacked divider is
  unchanged.
- `LandingHero` now wraps both doors in one `flex flex-col sm:flex-row
  sm:items-center` container, unchanged on mobile and side by side from `sm`.
- `AgentDoor.tsx:108` changed `min-h-full` to `min-h-screen`, the idiom every
  other full-bleed page in this codebase already uses.

Not done: no change to `AgentDoor`'s own in-card divider (`AgentDoor.tsx:190`,
signed-out "do you have a journal" card) — it was not reported and stays
stacked at every width as before.

## Acceptance

`components/LandingSections.tsx`: the two hero doors sit in one row at 1280px
and stay stacked with the horizontal divider at 390px (checked in
`.claude/runs/2026-09-09-whatsapp-agent/B1325`). `/agent` (signed out, short
content) is one uniform colour from the door content to the bottom of the
viewport at both widths, in the same run.
