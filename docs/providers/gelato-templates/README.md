# Gelato's own product templates

**The only reference for what a print file should be that comes from the
printer rather than from us.** Everything else in `docs/providers/photobook.md`
is measured off the API or inferred from a preview. A template is the file
Gelato hands a designer and says "fill this in", so where it and we disagree,
we are wrong.

Downloaded from the Gelato dashboard — open the product, three-dot menu,
*Download template*. There is no API for it, so a person has to fetch them.
All six are here, one per size-and-cover this repository offers.

Each is 31 pages: **one cover page, then thirty interior pages.**

## What they say, against what this repository emits

Checked 2026-09-08 with a 28-page book, whose spine matches the templates'.
Every figure below is ours measured against theirs, not ours computed twice.

| Product | Template cover | Ours | Template interior | Ours |
| --- | --- | --- | --- | --- |
| softcover 140 × 140 | 288.72 × 146 | 288.72 × 146 | 146 × 146 | 146 × 146 |
| softcover 200 × 200 | 408.72 × 206 | 408.72 × 206 | 206 × 206 | 206 × 206 |
| softcover 210 × 280 | 428.72 × 286 | 428.72 × 286 | 216 × 286 | 216 × 286 |
| hardcover 200 × 200 | 458 × 246 | 458 × 246 | 206 × 206 | 206 × 206 |
| hardcover 210 × 280 | 478 × 326 | 478 × 326 | 216 × 286 | 216 × 286 |
| hardcover 280 × 280 | 618 × 326 | 618 × 326 | 286 × 286 | 286 × 286 |

**Every page of every template carries `TrimBox == BleedBox == MediaBox`.**
That is not print convention — convention puts the TrimBox at the finished
size, inside the bleed — and it is what the printer's own reference does, so
it is what we do now. It is not cosmetic either: Gelato positions artwork from
the TrimBox, and an inset one made it rescale the whole sheet and clip the
title off the hardcover mock-up.

## The hardcover guides, read off the template

`hardcover-200x200-30pp.pdf` draws a hatched turn-in border and dashed panel
boxes. Their vertical rules fall at **19.9 / 226.9 / 437.7 mm** on a 458 mm
sheet, which is the API's `contentBackSize.left` 20, the spine at 226-232 and
`contentFrontSize` ending at 438 — the two sources agree, and our front panel
starts at 239.9 against their 240.

## What is still not settled by any of this

These files prove **geometry**. They say nothing about **preflight** — the
resolution, the fonts or the colour space Gelato will accept. This writer
still emits RGB with unembedded base-14 Helvetica, and no draft order runs
prepress. That is unchanged and is the open risk.
