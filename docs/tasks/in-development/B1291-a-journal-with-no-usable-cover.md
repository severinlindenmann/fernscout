---
id: B1291
title: A journal with no usable cover renders half a card of flat colour on the landing page
type: ISSUE
priority: low
complexity: low
area: landing
found: "2026-09-10T10:59:24Z"
started: "2026-09-11T15:12:41Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T15:12:41Z"
---

# B1291 — A journal with no usable cover renders half a card of flat colour on the landing page
## Why

On the landing page at 390px, each journal is a card with a ~180px image band
above its title. When the journal has no usable cover, the band is drawn anyway:

- **Test Elena** — 180px of flat cream, entirely blank.
- **Test Jonas** — 180px of flat mustard.

So half the card is a coloured rectangle that says nothing, on a phone, in the
list that is meant to make somebody want to open a journal. The blank one in
particular reads as an image that failed to load.

The demo's card, which has a photograph, shows what the layout is for.

## Work

- Decide what a coverless journal's card looks like. Dropping the band and
  letting the card be title-and-line is the smallest answer and probably the
  right one; anything drawn there has to earn 180px of a phone screen.
- The mustard block is presumably a deliberate fallback tint. Whether a solid
  brand colour is better than no band is a judgement — look at both at 390px
  rather than reasoning about it.

## Acceptance

- A journal with no cover photograph renders a card with no empty image band.
- A journal with one is unchanged.
