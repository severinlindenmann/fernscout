---
id: B497
title: The photobook draws one hardcoded couple whoever travelled
type: FEATURE
priority: medium
complexity: high
area: photobook, travellers
found: "2026-09-05T16:23:52Z"
started: "2026-09-05T17:03:18Z"
merged: "2026-09-05T17:17:15Z"
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

**Scope decided 2026-09-05: full parity, and a trip that describes nobody
prints nobody.** That is larger than this ticket was first written for, and
the complexity is `high` rather than `low` accordingly.

The blocker is gone — `travellers:` landed in B11, and B498 added `outfit`.

### The obstacle, and the shape of the answer

`PdfBuilder.drawPath` takes **raw PDF content-stream operators**, not SVG path
data: it interpolates the string straight into the stream. So the book cannot
simply be handed the site's paths, and today it does not try — it has its own
`roundedRect`/`ellipse` helpers and its own copy of the palette.

Two spellings of one geometry is what `travellersSvg` already says it wants,
and the way to get it:

1. **`lib/travellers/shapes.ts`** — the figure as an array of primitives
   (`path` with an SVG `d`, `circle`, `ellipse`, `rect`, each with a fill and
   an optional stroke). One place, and the only place, that knows what a
   traveller looks like.
2. **`render.ts` serialises that to SVG**, which is what it already produces.
   Its output must stay visually identical; it is on every journal's first
   screen.
3. **An SVG-`d` → PDF-operator converter.** Quadratics convert to cubics
   exactly; **arcs are the real work** — the hair paths use `a15 15 0 0130 0`
   and PDF has no arc operator, so they need the standard arc-to-bezier
   decomposition. Relative commands too. This is the piece to test on its own.
4. **`lib/photobook/travellers.ts` consumes the shapes**, keeping its `place`
   flip (SVG counts y downwards, PDF upwards) and losing `HIM`, `HER` and
   `Look`. Widening `Look` was the earlier plan and is now the wrong one: with
   11 hair styles, 5 outfits and 8 accessories, a parallel colour record is a
   second description of the same person.
5. **The arrangement too.** `arrangeParty` decides ranks, overlap and the
   0.62 floor; the book currently draws a fixed side-by-side row. A family
   should stand in the book the way it stands on the site.
6. **Read it through**: `buildBookSource` → `BookSource` → `drawTravellers`
   and `travellersSvg`, including the HTML preview, whose whole job is to be
   evidence about the printed page.

### A trip that describes nobody prints nobody

No `travellers:` on the trip **and** none on the journal means the title page
and the colophon draw no figures at all, and the space closes up rather than
leaving a hole. Not the journal's default and not a neutral figure: the site
can afford a placeholder because it is a decoration on a page that has other
content, and a printed book is a keepsake that would be asserting who was
there. `ask, never infer`, applied to the one artefact somebody keeps.

This changes the layout of every book made from a trip that has not been
described, so the title page needs to look composed without them.

**Not doing:** changing the likeness. The book is a port of the site's figure,
and any shape that differs is a bug in the port.

## What building it turned up

**`PdfBuilder.drawPath` takes PDF operators, not SVG path data.** It
interpolates the string straight into the content stream. That is the whole
reason the duplication existed, and it means "share the paths" was never going
to be a one-line change — `lib/travellers/path.ts` is the answer: an SVG path
parser and an arc-to-cubic converter, tested against a quarter circle's known
control points.

**Arc flags can be packed against the number after them.** `a4.6 4.6 0 109.2 0`
is large-arc=1, sweep=0, x=9.2 — not a number 109.2. A tokeniser that reads
numbers greedily lands the endpoint hundreds of units away and the shape
deforms silently. It has its own test.

**The refactor went the other way round from the plan.** The Work section said
to map the block onto `Look`. What actually happened is that `Look` is gone:
`lib/travellers/shapes.ts` now holds the figure as geometry and both
`render.ts` (SVG) and `lib/photobook/travellers.ts` (PDF) serialise it. With
11 hair styles, 5 outfits and 8 accessories a parallel colour record would
have been a second description of the same person, which is the thing that
broke in the first place.

**Opacity has to be flattened.** The site uses it on the shirt yoke, the
cheeks, the eye highlights and half the hair detail; the PDF writer has no
alpha and the PDF/X report counts transparency against us. Composited against
white, which is what a printer would have done anyway.

## Acceptance

- A trip whose `travellers:` says one person with black coiled hair in a dress
  prints exactly that, on the title page and in the colophon — not long hair,
  not trousers.
- Every hair style, outfit and accessory renders in the PDF, and a rendered
  page is compared against the site's SVG of the same figure by eye at least
  once.
- The arc converter has its own test: a quarter, a half and a full circle
  against known bezier control points.
- A party of four prints with the children in front, as on the site.
- A trip with no `travellers:` and a journal with none prints no figures, and
  the title page still looks composed.
- The HTML preview and the PDF show the same party — one geometry, two
  spellings.
