---
id: B1172
title: Photographs go into the book at camera resolution, so the printer cannot render it
type: ISSUE
priority: high
complexity: medium
area: photobook, print
found: "2026-09-09T22:20:00Z"
started: "2026-09-09T20:14:16Z"
session: ce87fdc2-3f66-428c-90d3-ae9d8df84e40
claimed: "2026-09-09T20:14:16Z"
---

# B1172 — Photographs go into the book at camera resolution, so the printer cannot render it

## Why

A JPEG is embedded byte-for-byte as a DCTDecode stream, which
`lib/postcard/pdf.ts:113` states as a deliberate choice: *"the bytes come out
the way the sensor read them"*. That is right for a postcard — one photograph,
one card. A photobook is sixty of them.

Measured on the live order `b17146b4-…` (Algarve 2026, 46 pages, 200 × 200 mm):

```
book-interior.pdf   355.9 MB   46 pages   63 images, all DCTDecode
book-cover.pdf       11.8 MB
largest images      5712×4284, 4032×3024, 4000×1800
largest streams     10.5, 10.4, 10.4, 10.1, 9.7 MB
```

A 200 × 200 mm page at 300 dpi needs about 2362 px on a side. 5712 px is 2.4×
that in each dimension — roughly six times the data the press can use.

**Gelato rendered the cover and not the interior.** Their prepress reported
*"only the cover renders"* and *"There is an issue with the design file for
this product"*. 11.8 MB was fine; 356 MB was not.

This is also why the storage ceiling (B661) is closer than it looks — one book
is a third of a gigabyte — and why building takes as long as it does.

## Work

- Re-encode each photograph to its **placed size at 300 dpi** before embedding,
  with `sharp` (already a dependency, `package.json:62`). A photograph placed
  120 mm wide needs 1417 px, whatever the camera wrote.
- Keep the DCTDecode path: the re-encoded bytes are still a JPEG and still
  embed as a stream. What changes is which bytes.
- Never upscale. A photograph smaller than the placed size keeps its own
  pixels, and `low-resolution` already warns about it.
- EXIF orientation is applied in the placement transform today
  (`lib/postcard/pdf.ts:108`). If `sharp` bakes the rotation in, that transform
  must stop being applied to re-encoded images, or every rotated photograph
  turns twice. Worth a test with each of the eight tags.
- Check the cover renderer too, though 11.8 MB suggests it is already sane.

## Acceptance

- A 46-page book of the same trip builds to tens of MB rather than hundreds.
- Gelato's prepress renders the interior.
- A photograph that was rotated by EXIF still prints the right way up.
- `npm run verify`.
