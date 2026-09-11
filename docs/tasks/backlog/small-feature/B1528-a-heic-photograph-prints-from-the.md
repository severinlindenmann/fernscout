---
id: B1528
title: A HEIC photograph prints from the web copy because nothing kept a JPEG the printer can embed
type: FEATURE
priority: medium
complexity: medium
area: ingest
found: "2026-09-11T20:22:15Z"
---

# B1528 — A HEIC photograph prints from the web copy because nothing kept a JPEG the printer can embed

## Why

Both printers embed JPEG bytes verbatim as a DCTDecode stream (`readJpeg`,
`lib/postcard/pdf.ts`) and can do nothing with a HEIC or a RAW. So
`printSourceFor` (`lib/photobook/source.ts:196`) looks for a kept original,
finds `01.heic`, cannot use it, and falls back to the 2000px web derivative —
honestly, with a `fallbackReason`, but it falls back.

On a 154 × 111 mm card that is about **244 dpi where the camera file would
give 660** (B1010's own figures). Every iPhone photograph taken since about
2018 is HEIC by default, so this is not an edge: it is most phones, printing
from the copy this product made for the web.

The decoder is already here. `lib/ingest/image.ts` finds an external HEIF
decoder (`findHeifDecoder`, `decodeSource`) and already converts the file to
build the derivative — the full-resolution pixels pass through ingest and are
then thrown away.

## Work

At ingest, when the source is not a JPEG the print path can use, write a
full-resolution JPEG into `originals/` beside whatever the camera wrote.

**The print path then needs no change at all.** `findOriginal` matches on
basename with any extension and `PRINTABLE` is JPEG-first, so `01.jpg` landing
beside `01.heic` in `originals/` is preferred automatically — that rule was
written for exactly this shape.

Two decisions for whoever builds it, both the owner's storage either way:

- **Keep both, or keep only the JPEG.** Keeping both is safer (the camera file
  is what the owner handed over, and a re-encode is lossy) and costs the most:
  a JPEG from a HEIC is usually *larger* than the HEIC. Keeping only the JPEG
  halves the cost and throws away the file the owner gave us, which this
  project does not otherwise do.
- **Quality and subsampling.** The photobook already writes print JPEGs at a
  chosen quality with 4:4:4 (`lib/photobook/images.ts`); match it rather than
  inventing a second answer.

**Storage is a real constraint, not a footnote.** `lib/storageQuota.ts` counts
the whole of `content/<user>/` against `perUserBytes` (B661, 5 GB by default),
so this raises what an import costs and can push a journal over. An ingest that
silently doubles a photograph's footprint is a surprise; decide whether the
conversion is skipped or the import refused when the quota would break, and say
which in the ingest report.

**RAW is a separate question and is not in this ticket.** CR2/NEF/ARW need
libraw or dcraw, which is a different dependency from the HEIF decoder already
present, and a RAW has no single correct rendering — a demosaic is a choice
about somebody's photograph. HEIC/HEIF is the case that is both common and
mechanical.

## Acceptance

A trip ingested from a HEIC source prints its photographs at the original's
resolution: `printSourceFor` returns the converted JPEG with its real
dimensions and no `fallbackReason`, and the postcard's low-resolution warning
goes quiet where the camera file was big enough. Re-ingesting an already
imported trip converts nothing twice (`.ingest.json`). The storage decision
above is implemented and named in the task file.
