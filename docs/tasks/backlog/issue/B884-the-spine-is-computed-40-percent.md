---
id: B884
title: The spine is computed 40 percent too narrow and the cover artwork will creep
type: ISSUE
priority: high
complexity: low
area: photobook, print
found: "2026-09-07T18:08:32Z"
---

# B884 — The spine is computed 40 percent too narrow and the cover artwork will creep

## Why

`spineWidthMm` in `lib/photobook/spec.ts` computes `(pages / 2) * paperCaliperMm`
with `paperCaliperMm: 0.115`. Gelato publishes the real answer, and ours is
about 40% too narrow:

| pages asked | Gelato uses | Gelato spine | ours |
| --- | --- | --- | --- |
| 28 | 32 | 2.72 mm | 1.84 mm |
| 32 | 36 | 3.03 mm | 2.07 mm |
| 52 | 56 | 4.58 mm | 3.22 mm |
| 100 | 104 | 8.30 mm | 5.98 mm |
| 160 | 164 | 12.95 mm | 9.43 mm |
| 200 | 204 | 16.05 mm | 11.73 mm |

Measured 2026-09-07 with
`GET https://product.gelatoapis.com/v3/products/{productUid}/cover-dimensions?pageCount=N&measureUnit=mm`
against the 200 x 200 softcover.

Two facts our model does not have:

- **Gelato adds 4 pages** before computing the spine, consistently across the
  whole range — endpapers, presumably.
- Its own relationship is exactly linear:
  `spine = 0.24 + 0.155 * ((pages + 4) / 2)` mm, which reproduces every row
  above. Our caliper of 0.115 should be about 0.155, and there is a 0.24 mm
  constant we do not model at all.

`spineWidthMm`'s own comment says what this costs: "Getting this wrong does not
fail preflight — it produces a cover whose front image creeps around onto the
spine, which is only visible on the finished object." That is exactly the state
the code is in. Nothing has ever been printed, so nothing is damaged; it simply
must not be printed before this is fixed.

## Work

The lazy fix is to correct the two constants. The right fix is probably not to
compute the spine at all.

That same endpoint returns the whole cover geometry — bleed box, back panel,
spine, front panel, and for a hardcover the wrap and the two 8 mm joints — per
product and per page count. A spine we derive is a spine that can drift from
the printer's again; one we fetch cannot. So:

- `lib/photobook/gelato.ts` gains `coverDimensions(productUid, pageCount)`.
- The cover renderer takes its geometry from that answer when it has one.
- It falls back to the constants when there is no key, because AGENTS.md
  requires that no feature needs a paid account to develop or test — and the
  fallback constants should be corrected to the fitted formula above so the
  offline answer is close rather than wrong.

Decide which of the two before building; the second is the reason this is filed
rather than fixed in passing.

## Acceptance

- A 52-page 200 x 200 softcover renders a spine of 4.58 mm, not 3.22 mm.
- A test asserts the spine against at least three of the measured rows above.
- `npm run photobook -- --guides` on a real trip shows the spine guides landing
  where the artwork actually divides.
- Blocks B865: no book may be sent to a printer until this is right.
