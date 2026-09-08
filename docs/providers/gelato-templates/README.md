# Gelato's own product templates

**The only reference for what a print file should be that comes from the
printer rather than from us.** Everything else in `docs/providers/photobook.md`
is measured off the API or inferred from a preview; a template is the file
Gelato hands a designer and says "fill this in".

Downloaded from the Gelato dashboard: open the product, three-dot menu,
*Download template*. There is no API for it, so a human has to fetch one and
drop it here.

| File | Product | What it settles |
| --- | --- | --- |
| `softcover-210x280-30pp.pdf` | `photobooks-softcover_pf_210x280-mm-8x11-inch_…_ver`, 30 inner pages | cover and interior page sizes, and that every box spans the page |

## What the softcover template says

Thirty-one pages: **one cover at 428.72 × 286 mm**, then **thirty interior
pages at 216 × 286 mm**. Those are exactly the sizes this repository emits for
a 210 × 280 book — cover `2 × 210 + spine 2.72 + 2 × 3` wide by `280 + 2 × 3`
tall, interior `210 + 2 × 3` square-on.

**Every page carries `TrimBox == BleedBox == MediaBox`.** That is not print
convention — convention puts the TrimBox at the finished size, inside the
bleed — and it is what the printer's own reference file does, so it is what we
do. It is also not cosmetic: Gelato positions artwork from the TrimBox, and an
inset one made it rescale the whole sheet. The same hardcover submitted twice,
once unaltered and once with the TrimBox key renamed away, moved its flat
preview from 86.3% of the canvas to 100%.

The trim is still known — `mapClipMm`, the `--guides` overlay and the PDF/X
report all compute it from `spec` and `CoverGeometry`. It is simply not
declared as a box.

## What is still missing

**A hardcover template.** Every hardcover number we hold — the 17 mm case
side, the 8 mm joints, the 3 mm image-wrap fold, the board being 2 mm narrower
and 6 mm taller than the page — comes from
`GET /v3/products/{uid}/cover-dimensions` and the product's `dimensions`
block. Those agree with each other and our file matches them to a tenth of a
millimetre, but no file from Gelato has confirmed the *layout* of a case, and
its dashboard mock-up crops hardcovers wrongly, so it cannot be used as a
check either. Drop one in here when somebody downloads it.
