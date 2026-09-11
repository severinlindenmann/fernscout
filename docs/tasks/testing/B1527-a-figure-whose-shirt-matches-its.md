---
id: B1527
title: A figure whose shirt matches its skin tone renders as nude, and nothing warns
type: ISSUE
priority: low
complexity: low
area: ui, travellers
found: "2026-09-11T20:35:00Z"
started: "2026-09-11T20:56:32Z"
merged: "2026-09-11T21:15:37Z"
---

# B1527 — A figure whose shirt matches its skin tone renders as nude, and nothing warns

## Why

Asked by an owner on 2026-09-11, looking at their own journal: *"why are the
figures looking like naked?"*

They were dressed. Both figures had `skin: light` and `shirt: cream`, and at
figure size — a couple of hundred pixels, flat fills, no outline — cream against
light skin is the same colour. The torso, the arms and the face read as one
continuous shape. The garment is drawn; it is simply invisible.

This is not a rare combination. `cream` and `sand` sit next to `light` and
`light-medium` in the palette, and a light-skinned person in a white shirt is
an extremely ordinary thing to describe. The vocabulary invites it: every value
is legitimate on its own, and nothing anywhere hints that two of them together
produce a nude pictogram of somebody's family.

The `preview` route is the existing safeguard and it worked — the agent rendered
the party, looked at it, and the problem was visible. But it was only caught
because somebody thought to look; a caller that trusts the vocabulary and writes
straight through gets no signal at all.

## Work

The robust fix is in the drawing, not in the validation: give the garment a
thin darker edge, or a slight tonal shift against the skin beneath it, so a
low-contrast pairing still reads as clothing. That fixes every combination at
once, including ones nobody has enumerated — `sand` on `light-medium`, `rich`
skin against a dark shirt.

Cheaper and weaker, if the drawing is not to be touched: have
`PATCH …/travellers` and `preview` return a note when a garment colour is within
some small distance of the skin tone. A note, not a refusal — somebody may want
exactly that, and refusing a legal combination of legal values would be worse
than the problem.

Not worth doing: removing colours from the palette, or forbidding pairings. The
vocabulary is small and every word in it is reasonable.

## Acceptance

- A figure with `skin: light` and `shirt: cream` reads as clothed at figure size.
- The same holds for the other near-pairings in the palette, not just this one.
- No legal combination of vocabulary values is refused.

## Done

Fixed in the drawing, as the Work section recommended — not the cheaper
warning-note fallback.

`lib/travellers/shapes.ts` gained one helper, `edged(fill)`, that returns the
garment's own fill plus a stroke that is that same colour darkened
(`shade(fill, 0.62)`), at `width: 0.9`. It is applied to every garment shape —
the torso path, both sleeve rects, and the pants-coloured leg rects for
`trousers` (always) and for the `shorts`/`skirt` outer garment — but not to
bare-skin shapes (the skin-coloured leg insets under a skirt/dress/shorts) or
to the semi-transparent shading overlays that already sit on top of a garment
(adding a second stroke there would double the line and clutter the figure).

This is unconditional and generalises to every skin/garment pair by
construction: the stroke is derived from the garment's own colour, never
compared against the skin tone, so there is no lookup table of "close" pairs
to keep in sync as the palette grows. A dark shirt's edge is barely
perceptible against its own fill and adds no clutter; a light shirt's edge is
exactly the missing line.

Two files needed a matching change to carry a stroke on a `rect`, which
previously supported only `fill`:

- `lib/travellers/shapes.ts` — `Shape`'s `"rect"` variant gained optional
  `stroke`/`width`, matching every other shape kind.
- `lib/photobook/shapes.ts` — `strokeWidth()` special-cased `rect` to always
  return `1`; it now reads `shape.width` for a rect the same as for every
  other kind, or the site and the printed book would draw two different
  outlines for the same figure.

Both existing SVG serialisers (`lib/travellers/render.ts` for the site/preview,
`lib/photobook/travellers.ts` for the photobook preview) and the PDF painter
(`lib/photobook/shapes.ts`) already read `stroke`/`width` generically off any
shape kind, so no serialiser needed a code change beyond the `strokeWidth` fix
above.

**Visual verification**, at `/docs/branding/travellers` ("One figure" panel,
150px), local dev server, before/after by `git stash`/`git stash pop`:

- `skin: light` + `shirt: cream` (the reported pairing) — before, the torso,
  arms and face read as one continuous pale shape; after, a visible darker
  line runs along the shoulders, sleeves and torso outline, and the garment
  reads as clothing.
- `skin: light-medium` + `shirt: sand` (the ticket's other named near-pairing)
  — same result: an edge appears where none was visible before.
- `skin: rich` + `shirt: slate` (a dark/dark pairing that already had enough
  contrast) — the edge is present but subtle and adds no visible clutter,
  confirming the fix does not visually spoil a pairing that was never broken.

Screenshots (session scratchpad, not committed):
`/private/tmp/claude-501/-Users-severin-Documents-GitHub-fernscout/bfe90fb0-0095-4532-8af8-601ad489b14c/scratchpad/b1527-screenshots/`
— `b1527-before-light-cream-figure.png`,
`b1527-after-light-cream-figure.png`,
`b1527-after-sand-lightmedium.png`,
`b1527-after-rich-slate.png`, `b1527-after-full.png` (the whole bench, for
context).

Third acceptance line: no palette value was touched. `SKIN` and `CLOTH` in
`lib/travellers/vocabulary.ts` are unchanged — every value in `npm run
verify`'s `Every value` grid on the bench still renders, and no combination is
refused anywhere in the write path.

`npm run verify` (build → tsc → eslint → vitest → knip): all 5 steps passed —
539 test files, 7048 tests passed (4 skipped, Postgres dialect only, as usual
locally).
