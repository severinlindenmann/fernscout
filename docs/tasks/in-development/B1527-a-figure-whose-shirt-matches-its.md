---
id: B1527
title: A figure whose shirt matches its skin tone renders as nude, and nothing warns
type: ISSUE
priority: low
complexity: low
area: ui, travellers
found: "2026-09-11T20:35:00Z"
started: "2026-09-11T20:56:32Z"
session: bfe90fb0-0095-4532-8af8-601ad489b14c
claimed: "2026-09-11T20:56:32Z"
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
