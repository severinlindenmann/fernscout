---
id: B1008
title: The print target is PDF/X-4 and the fonts are not embedded
type: ISSUE
priority: high
complexity: medium
area: photobook, print
found: "2026-09-08T18:27:03Z"
started: "2026-09-08T19:11:41Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T19:11:41Z"
---

# B1008 — The print target is PDF/X-4 and the fonts are not embedded

## Why

`lib/photobook/pdfx.ts` reports readiness against **PDF/X-1a:2001** and calls
DeviceRGB a failure needing "a colour engine". `docs/providers/photobook.md`
repeats it as the uncomfortable thing about this writer.

Gelato's own downloadable template — `docs/providers/gelato-templates/` —
declares `GTS_PDFXVersion (PDF/X-4)`, and their support pages say the same:
export PDF/X-4, output intent GRACoL 2006. **PDF/X-4 permits RGB** with an
output intent, so the colour conversion this repository has been treating as
the blocker is not one.

What their template does that ours does not:

| | Gelato's template | ours |
| --- | --- | --- |
| PDF/X version | PDF/X-4 | none declared |
| Fonts | `KNFGCT+GelatoSans-Light`, embedded and subset | base-14 Helvetica, referenced |
| OutputIntent | present | absent |
| Colour | RGB, permitted under X-4 | RGB |

So the real gap is **font embedding**, and after that an output intent and the
X-4 identification. Not a colour engine.

This matters because it is the last thing standing between us and a real
order. A printer substitutes a font it does not have, and nobody finds out
until the parcel arrives.

## Work

- Retarget `pdfx.ts` at PDF/X-4: RGB stops being a failure, and the report
  stops recommending a Ghostscript CMYK conversion nobody should run.
- Embed and subset the interior and cover fonts. `lib/postcard/pdf.ts` is a
  hand-rolled writer with base-14 references, so this is real work: a TrueType
  subsetter, or handing off to Ghostscript, which is not installed here and
  would become a deployment dependency. Decide which before building.
- Emit `/OutputIntent` with an ICC profile and the `GTS_PDFXVersion` key. The
  CLI already accepts `--icc`; the web order path has no equivalent, so a book
  ordered from the button would still carry no intent. Both paths need it.
- Correct `docs/providers/photobook.md`, which frames the colour space as the
  problem.

## Acceptance

- `pdffonts` on a generated interior and cover reports every font `emb yes`.
- The file declares PDF/X-4 and carries an output intent.
- One real order is promoted at Gelato and prepress accepts it — that is the
  only check that counts, and it needs a payment method and a real address.
