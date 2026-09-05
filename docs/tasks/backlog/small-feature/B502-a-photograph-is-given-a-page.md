---
id: B502
title: A photograph is given a page it has not the pixels to fill
type: FEATURE
priority: medium
complexity: medium
area: photobook, print
found: "2026-09-05T17:05:25Z"
---

# B502 — A photograph is given a page it has not the pixels to fill

## Why

The planner chooses a slot from a photograph's *shape* and never from its
*size*. `groupPhotos` asks whether a picture is portrait, landscape or a
panorama; nothing asks whether it has the pixels for the page it is about to
be given.

So a 1067px photograph can be handed a full-bleed 324mm page, which needs
3826px, and print at 93 DPI. The planner then warns about the thing it just
decided to do — `checkResolution` in `lib/photobook/plan.ts` reports it, and
the reader is told their book will be soft rather than being handed a book that
is not.

The warning is the right last line of defence and should stay. But a book has
somewhere better to put that photograph: the same picture in a quarter-page
grid slot at 72mm needs only 850px and prints sharp.

Found while fixing B496's rhythm, where heroes became deliberate rather than
automatic — which makes *which* photograph gets the big page a decision the
planner is now actually making.

## Work

Give `groupPhotos` and the hero choice a resolution floor: a photograph may
only take a slot it can fill at some fraction of the target DPI. Decide that
fraction — 300 is the target, 200 is a defensible floor for a full page, and
150 is where most people stop noticing at arm's length. Write down which and
why, because it is the whole of this ticket.

Consequences to think through rather than discover:

- A trip whose photographs are *all* small then has no hero at all. Is a book
  of grid pages better than a book of soft full pages? Probably, but say so.
- Page count moves, and so does the price.
- `expandToMinimum` breaks pages apart to reach the binder's minimum, which
  pushes photographs into *larger* slots — the two rules can fight, and this
  one should win.

**Not doing:** removing or quietening the warning. It is what catches the case
this cannot: a photograph that is soft even in the slot it was given.

## Acceptance

- A photograph below the floor is never given a full-bleed or feature page
  while a grid slot is available.
- The low-resolution warning still fires for a photograph that is soft in the
  slot it did get.
- A book of entirely small photographs still plans, still binds, and says in a
  warning that it had nothing big enough to run large.
