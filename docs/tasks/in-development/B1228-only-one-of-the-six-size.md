---
id: B1228
title: Only one of the six size-and-cover combinations has ever reached a printer
type: CHORE
priority: high
complexity: medium
area: photobook, print
found: "2026-09-10T05:32:00Z"
started: "2026-09-10T05:08:48Z"
session: ce87fdc2-3f66-428c-90d3-ae9d8df84e40
claimed: "2026-09-10T05:08:48Z"
---

# B1228 — Only one of the six size-and-cover combinations has ever reached a printer

## Why

Everything learned in the last day — photographs at print resolution (B1172),
the two blank leaves Gelato counts (B1173), one PDF with the cover as page 1
(B1205), the leaves before the colophon (B1206), the CLI fetching the real
cover geometry — was measured against exactly one product: **softcover
200 × 200**.

The code is generic and should carry to the rest, but "should" has been wrong
about this printer at every step. The other five have never been built since
any of it landed, and the hardcover ones differ in the way most likely to
break: a hardcover sheet wraps boards and has a joint either side of the
spine, so its cover geometry is a different shape and comes from a table
Gelato maintains rather than a formula.

The six, from `lib/photobook/spec.ts`:

| Size | Soft | Hard |
| --- | --- | --- |
| pocket 140 × 140 | yes | — |
| square 200 × 200 | yes | yes |
| portrait 210 × 280 | yes | yes |
| large-square 280 × 280 | — | yes |

## Work

- Build the same trip in every combination.
- Check each: total pages = declared + 3, page 1 the cover at Gelato's own
  `cover-dimensions` for that product and page count, the rest at the trimmed
  page, and the file tens of megabytes rather than hundreds.
- Send one example per combination to the owner so a person can put them
  through Gelato's uploader by hand.

## Acceptance

- Six books, six mails, each carrying one PDF the owner can upload.
- Every one passes the checks above.
