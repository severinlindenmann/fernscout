---
id: B1511
title: The message on the back preview is far larger than the message that prints
type: ISSUE
priority: high
complexity: medium
area: postcards
found: "2026-09-11T19:19:16Z"
started: "2026-09-11T19:25:10Z"
session: 3f748903-2dc3-47a2-a958-98b83d641dc0
claimed: "2026-09-11T19:25:10Z"
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

## What it turned out to be — not a wrong size

The preview's size is derived from the print size and always has been:
`fontFraction(MESSAGE_PT, spec)` in `cqw` against the card. What it also has,
since B1286, is a **floor**:

```
max(2.385cqw, 14px)
```

At a card 358px wide — a phone — the true size is **8.5px** and the floor
renders **14px**, two thirds larger. Above about 590px of card width the floor
stops mattering and the preview is exact. The caption already tells the truth
about it: it says *nicht massstabsgetreu* whenever the floor is in play.

So the trade is deliberate and right — 8px is not readable — and the thing it
costs is the only question the preview is there to answer: **does what I wrote
fit.** A card that looks full may have room, and somebody cuts a sentence they
did not need to.

## Work

Answer the fit question from the renderer instead of from the picture.
`messageFit` in `lib/postcard/render.ts` runs the same wrap, the same box and
the same leading the PDF uses, and the page prints one line under the card:
it fits, or how many lines will not be printed.

Not doing: lowering the floor. It is 14px because that is the size of the
field the message is actually typed into, and a preview nobody can read is
worse than one that is not to scale.

Original plan, kept for the record:
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