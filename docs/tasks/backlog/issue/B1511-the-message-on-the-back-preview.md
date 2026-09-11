---
id: B1511
title: The message on the back preview is far larger than the message that prints
type: ISSUE
priority: high
complexity: medium
area: postcards
found: "2026-09-11T19:19:16Z"
---

# B1511 — The message on the back preview is far larger than the message that prints

## Why

On the Write step the message nearly fills the back of the card; on the PDF
that goes to Stannp the same words sit in the top third at a comfortable
reading size. The preview is supposed to be the card at print size — that is
what the label under it says — so one of the two is wrong about the type, and
it is the preview.

It matters more than it looks: the preview is where somebody decides whether
what they wrote fits. If it reads as full when it is not, they cut a sentence
they did not need to cut.

## Work

Find where the two sizes come from. `lib/postcard/render.ts` sets the printed
size in real units against the card's trim; `PostcardBack` draws the preview in
CSS pixels against whatever width the frame has. The preview's size has to be
derived from the same ratio — font size as a fraction of the card's width —
rather than chosen independently.

Check the line height and the text block's inset the same way while there: if
the size was independent, those probably are too.

## Acceptance

The same message occupies the same proportion of the card in the preview as in
the rendered PDF, at 390 and at 1280. A message that overflows in print
overflows in the preview, and one that fits, fits.