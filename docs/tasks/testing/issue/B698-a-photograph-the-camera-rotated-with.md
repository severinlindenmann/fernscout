---
id: B698
title: A photograph the camera rotated with EXIF is stretched in the book
type: ISSUE
priority: high
complexity: medium
area: photobook, print
found: "2026-09-07T00:00:00Z"
merged: "2026-09-07T10:45:59Z"
---

# B698 — A photograph the camera rotated with EXIF is stretched in the book

## Why

Reported against the live site while checking B641: portrait photographs on
`/severin/trips/algarve-2026/photobook` are still drawn as landscape and
stretched. B641 looked for anisotropic scaling in the geometry, found none —
correctly, `scaledRect()` cannot produce it — and stopped there. The stretch
does not come from the geometry. It comes from the *dimensions fed into* it.

A phone writes a portrait photograph as landscape pixels plus an EXIF
orientation tag (6 or 8). Two halves of this codebase disagree about that:

- The derivative is stored upright — `lib/media.ts:207` and
  `lib/ingest/image.ts:157` both apply sharp's `.rotate()`.
- The **original** is stored byte-for-byte as uploaded
  (`lib/api/media.ts:365`), tag and all — and the photobook prints the
  original.

`dimensionsOf` (`lib/photobook/source.ts:204`) asks `readJpeg`
(`lib/postcard/pdf.ts:44`), which reads the SOF frame header and nothing else.
So a 3024×4032 portrait picture is reported to the planner as 4032×3024
landscape. Everything downstream is then consistently wrong: the planner calls
it landscape (`orientation()`, `plan.ts:522`), builds a landscape `draw` rect
from it, and

- the preview `<img>` — which is the **derivative**, upright — is squeezed into
  that landscape box by `object-fit:fill` (`preview.ts:670`). That is the
  visible stretch.
- the PDF embeds the original's bytes as a DCTDecode stream, so the printed
  page would carry the photograph on its side, filling the frame.

Verified locally: `sharp` writing orientation 6 gives `readJpeg` 400×300 while
`.rotate()` gives 300×400.

The same read is behind the postcard front (`lib/postcard/render.ts:156`,
`coverRect`) and the postcard page's resolution note
(`app/[user]/postcards/[id]/page.tsx:558`), so this is one fault in one
function with three callers, not three faults.

## Work

- `readJpeg` reads the EXIF orientation (`lib/ingest/exif.ts` already parses
  it, dependency-free) and reports `width`/`height` as the **displayed**
  dimensions — the thing every caller is actually reasoning about. The raw
  frame dimensions stay on the image as `pixelWidth`/`pixelHeight`, used only
  where the PDF `/XObject` dictionary needs them.
- `drawImage` and `drawImageClipped` apply the orientation as a `cm` matrix on
  the unit square, so the bytes land the right way up inside a rectangle that
  is already in display space.
- Not doing: re-encoding originals on upload. The bytes as the camera wrote
  them are the point of keeping them.

## Acceptance

- A JPEG carrying orientation 6 reports portrait dimensions from `readJpeg`.
- The `cm` operator for such a photograph rotates it, and the rectangle it
  fills has the photograph's own aspect ratio.
- A book planned from EXIF-rotated originals places them in portrait slots.
