---
id: B497
title: The photobook draws one hardcoded couple whoever travelled
type: FEATURE
priority: medium
complexity: low
area: photobook, travellers
found: "2026-09-05T16:23:52Z"
---

# B497 — The photobook draws one hardcoded couple whoever travelled

## Why

B496 put the site's two walking figures into the printed book — on the title
page and again in the colophon — because a book of somebody's journey should
have the people whose journey it was in it.

It draws the same two every time. `lib/photobook/travellers.ts` carries the
palette copied from `components/Travelers.tsx`: him with short brown-blond
hair, her with long brown hair. That is one particular couple, and it is
printed on the title page of every trip in every journal on the instance,
whoever actually went.

The `describe-a-traveller` skill exists on `main` and states the rule this
breaks in its own first line: **ask, never infer.** Somebody is building the
`travellers:` block in `trip.md` that the skill writes into; the drawing side
of it has not landed yet, so B496 had nothing to read.

`drawTravellers` already takes the figures as data — `look: Look[]`, defaulting
to the existing pair — so the seam is there and unused.

## Work

When the `travellers:` block lands, read it in `buildBookSource`, carry it on
`BookSource`, and pass it through `drawTravellers` and `travellersSvg`. Map
whatever shape that block has onto `Look` in `lib/photobook/travellers.ts`
rather than widening `Look` to match it — the printed figure has a fixed set of
shapes and only its colours vary, and the book should not acquire opinions
about a format the site owns.

Decide what a trip with no `travellers:` block prints. Drawing nobody is
defensible; drawing the journal's default is what the site does; drawing the
current hardcoded pair is the thing this ticket exists to stop.

**Not doing:** changing the shapes. The likeness is the component's, and the
book is a port of it.

## Acceptance

- A trip whose `travellers:` says one person with black hair prints one person
  with black hair, on the title page and in the colophon.
- No journal prints a figure nobody described.
