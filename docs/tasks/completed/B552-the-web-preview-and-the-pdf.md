---
id: B552
title: The web preview and the PDF renderer are two implementations of one layout
type: CHORE
priority: low
complexity: high
area: photobook, print
found: "2026-09-06T09:04:25Z"
started: "2026-09-06T14:20:15Z"
merged: "2026-09-06T14:31:02Z"
completed: "2026-09-07T13:11:54Z"
---

# B552 — The web preview and the PDF renderer are two implementations of one layout

## Why

`lib/photobook/preview.ts` (`routeSvg`) and `lib/photobook/render.ts`
(`drawRoutePage`) draw the route spread — the hardest page kind, with the
gutter, the graticule and the culling — from the same `RouteView`/`MappedPoint`
plan, through two separate bodies of drawing code. Most of the geometry is
already shared (`mapProjector`, `mapClipMm`, `graticuleStep`, `landPaths`,
`typeScale`, `contentBoxMm`, `measure`) — B519 and B518 were both cases of a
fix needed in both places, and each extraction closed one gap.

One gap was still open: the label-placement rule (`render.ts:455-500` before
this change, `preview.ts:224-266` before this change) — which stop gets a
name, which side of the dot it goes on, when a name is pushed back off the
edge — was implemented twice, in two different unit systems (PDF points in
the renderer, millimetres in the preview), with a comment in `preview.ts`
that said outright: *"The rule is copied deliberately rather than
approximated."* That is the shape B519 found drifting, admitted in the code
rather than hidden.

## Work

Spiked the route spread both ways at print quality — the PDF renderer against
a synthetic multi-stop route (six-figure trip, several countries, a fold in
the middle of a country) and the HTML preview against the same plan — to see
whether the duplication is superficial (units and drawing calls) or
structural (different decisions).

It is superficial. Every remaining difference between the two bodies of code
is a unit conversion (mm vs. points) or a target-specific drawing call
(`PdfBuilder.drawText` vs. an SVG `<text>` element); the actual **decisions** —
which land paths are visible, where the graticule lines fall, which stops get
a label and which side the label goes on — were already identical arithmetic
copied into two files.

Pulled the one decision that was still copied by hand — label placement —
into a shared pure function, `routeLabelPlacements()` in `lib/photobook/plan.ts`
(next to `mapProjector`/`mapClipMm`, which already own this page's geometry).
It takes stops already projected into the caller's own unit and a `widthOf`
callback, and returns which stops get a label and the anchor x for each; it is
unit-agnostic so the renderer can call it in points and the preview in
millimetres and get the same decisions from the same code. `render.ts` and
`preview.ts` each now call it once instead of each carrying the rule by hand.
Land culling and the graticule loop were left alone: they were already only a
few lines each and, worth noting, not the ones the comment flagged as a known
risk.

**Not doing:** anything under B547 (the UI) or replacing the renderer.
Considered and rejected: rendering the book as HTML/CSS once and producing the
PDF from that markup via Paged.js or Vivliostyle (found while researching
B547). See Acceptance for the weighing.

## Acceptance

**Decision: close this as not worth rewriting; the small extraction above is
the whole change.**

What the spike showed, weighed honestly:

- **What a library approach buys:** one body of layout code instead of two,
  so a fix like B519 or B518 cannot land in only one place, ever, by
  construction rather than by someone noticing the duplication and
  extracting it.
- **What it costs:** `lib/postcard/pdf.ts`'s `PdfBuilder` (which
  `render.ts` already uses) writes exact PDF bytes today — DCTDecode JPEG
  streams embedded byte-for-byte, no re-encoding, no image library, and it is
  tested and already emits what the print providers in
  `lib/photobook/providers.ts` want. Paged.js/Vivliostyle would mean:
  a new dependency; a headless browser (Chromium, via Playwright or
  Puppeteer) in the PDF-generation path, which today runs as a plain Node
  script with no browser anywhere in it; re-verifying every printer-facing
  guarantee this renderer currently gives by hand — bleed, trim, CMYK/RGB
  handling in `pdfx.ts`, the exact JPEG embedding — against whatever the new
  pipeline actually produces; and the route spread specifically, which needs
  precise clipping, a graticule and label collision-avoidance that CSS
  Paged Media has no primitive for, so it would still be hand-rolled SVG
  glued into the page, not simpler markup.
- **What the actual duplication turned out to be:** after B519's
  `graticuleStep()` extraction, the remaining duplication on the hardest page
  kind was one function's worth of arithmetic (the label rule above), not a
  whole layout engine's worth. The premise that motivated looking at a
  library — "two separate bodies of drawing code that keep silently
  drifting" — is real, but the fix that actually closes each drift, as B519
  and B518 both showed, is extracting the one shared decision into a pure
  function next to the geometry it belongs with. That is a much smaller
  and much safer change than replacing the renderer, and this ticket found
  and made the one remaining case of it.

**What would change this answer:** a *second* hard page kind (e.g. `photos`
with its layout math, or `costs`/`analytics`'s chart shapes — though those
already share `charts.ts`, B565) turning up more than a function or two of
copied decision logic, repeatedly, as new page kinds are added — i.e., if
extraction stops keeping pace with duplication. Nothing in this spike showed
that; `charts.ts` and `graticuleStep()` are the pattern working project-wide,
not local to the route spread.

Verified: `npm run verify` (build → tsc → eslint → vitest) is green with
`routeLabelPlacements()` in place; `test/photobook.test.ts`'s existing route
spread cases (in both `render.ts` and `preview.ts` paths) pass unchanged,
which is the "rendered both ways" check for this ticket — the same plan
produces the same label decisions through both bodies of code, because
they're now the same fifteen lines instead of two copies of them.
