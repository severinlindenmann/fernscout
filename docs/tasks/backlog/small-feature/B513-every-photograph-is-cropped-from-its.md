---
id: B513
title: Every photograph is cropped from its centre, whatever is in it
type: FEATURE
priority: medium
complexity: medium
area: photobook, print
found: "2026-09-05T20:42:56Z"
---

# B513 — Every photograph is cropped from its centre, whatever is in it

## Why

`cover()` in `lib/photobook/plan.ts:377` centres every crop:
`x: slot.x + (slot.width - width) / 2`. Always, for every photograph, in every
slot.

A portrait photograph in a landscape slot loses its top and bottom; a landscape
in a square slot loses its sides. Centred is the right default and it is wrong
often — a face near the top of the frame, a person standing at the left of a
wide shot, a horizon deliberately low. The reader gets a beheaded subject and
no way to say so.

This is the one thing the research on photo book editors singles out. Journi's
focal-point positioning is described as what "reduces cropping iterations
across varied photo sizes", and the tools without it "shift emphasis when
templates place images at different sizes" — which is precisely what a book
that puts the same photograph in a hero slot on one page and a quarter slot on
another does.

## Work

A focal point per photograph: two numbers, 0–1, defaulting to the centre, so a
photograph nobody has touched crops exactly as it does today.

Where it is stored is the decision. Options, and they are not equivalent:

- **In the book's options**, beside `hero` and `photos` — the arrangement's
  business, does not touch anybody's content, and is lost when a different book
  is made from the same photograph.
- **In the entry's frontmatter**, beside the caption — belongs to the
  photograph rather than to one book, so the website could use it too, and it
  means the composer writing to content, which nothing in the browser does
  today and which decision 24 has opinions about.

**Decided (2026-09-05): the book's options.** Three reasons, in order of
weight.

The composer is a browser surface, and ROADMAP decision 24 is that there is no
web editing interface for content. A focal point written into an entry's
frontmatter from a page in Chrome is the first crack in that, and it is not
worth spending on a crop.

A crop only exists because a book put the photograph in a slot of a particular
shape. The same picture is a hero on one page and a quarter on another, and the
point that saves it may differ; the *photograph* has no focal point, the
*placement* does.

And it is reversible. If the website later wants one too — `GalleryGrid` does
crop its thumbnails, so it might — the frontmatter is still there to move to,
and the book can read it in preference to its own. Starting the other way round
cannot be undone.

The cost, recorded so nobody rediscovers it as a surprise: a photograph used in
two books is adjusted twice. Most are used in one.

In the composer: tap a point on the thumbnail. That is the whole gesture, and
it wants to be visible only for a photograph that is actually being cropped —
offering it where the whole frame is printed is a control that does nothing.

**Not doing:** face detection. A tap is one gesture and always right; a
detector is a dependency, a model, and an opinion that is sometimes wrong about
somebody's family.

## Acceptance

- A photograph with a subject near an edge can be made to keep it, in a hero
  slot and in a grid slot.
- A photograph nobody has touched is placed exactly as it is today — assert it
  by comparing whole plans, as B504 does.
- A focal point on a photograph that is printed uncropped changes nothing.
