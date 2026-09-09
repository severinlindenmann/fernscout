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

**Do the subtraction, because it is the whole file-count rule** (B1173). These
are the **28**-page product — that is the book whose spine they match, below.
So the interior carries **two more pages than the book has**, and the files
together total `pageCount + 3`. Gelato's prepress refuses anything else, and
says so in those words: *"Product requires exactly 49 page(s), while file(s)
contain 47 page(s)"*. This sentence sat here for a day describing the answer
to a bug nobody had connected it to; `lib/photobook/render.ts` now draws the
two leaves, at the end.

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
resolution, the fonts or the colour space Gelato will accept.

**Preflight is no longer unmeasured, and the way to measure it is worth
knowing.** A real order (`orderType: "order"`) runs prepress *before* it checks
the payment method, so an account with no card is an unlimited free test rig:
the order always ends `failed / refused` with "Please add payment details", and
everything prepress found is on it. A **draft** runs no prepress at all, which
is why every check before 2026-09-09 passed and told us nothing.

Measured that way, prepress accepts what this repository now emits: fonts
embedded, RGB with an output intent, and photographs at 300 dpi (B1172 — it
refused a 356 MB interior outright). The remaining unknown is what the printed
object looks like, which no API answers.
