---
id: B885
title: A hardcover case is rendered as though it were a softcover
type: FEATURE
priority: high
complexity: medium
area: photobook, print
found: "2026-09-07T18:11:30Z"
started: "2026-09-07T18:15:28Z"
session: ce87fdc2-3f66-428c-90d3-ae9d8df84e40
claimed: "2026-09-07T18:15:28Z"
---

# B885 — A hardcover case is rendered as though it were a softcover

## Why

`BOOK_SIZES["large-square"]` is 280 x 280 hardcover — the only hardcover of the
three sizes, and the only one Gelato offers at that size. `render.ts` lays out
every cover the same way: back panel, spine, front panel, butted together, trim
plus 3 mm bleed. That is a softcover cover, and it is what a hardcover order
would currently send.

A real Gelato hardcover case is a different object. Fetched 2026-09-07 for
280 x 280 at 56 pages:

```
wraparoundInsideSize  618.0 x 326.0   thickness 17
wraparoundEdgeSize    584.0 x 292.0   at (17,17), thickness 3
contentBackSize       278.0 x 286.0   at (20,20)
jointBackSize           8   x 286.0   at (298,20)
spineSize               6   x 286.0   at (306,20)
jointFrontSize          8   x 286.0   at (312,20)
contentFrontSize      278.0 x 286.0   at (320,20)
```

Three things `BookSpec` has no concept of: an 8 mm **joint** either side of the
spine, a board panel that is **narrower and taller than the trim** (278 x 286
for a 280 x 280 book), and a 17 mm **wrap** outside the bleed.

`coverBoardMm` and `coverWrapMm` already exist in `BookSpec` and are read by
nothing but the spine sum, so this has never worked. An earlier attempt to
guess the numbers was stopped for exactly that reason.

## Work

**The spine stops being computed.** That is the same conclusion B884 reached
from the other direction — our caliper is 40% low — and one change answers both,
so this supersedes it.

`GET https://product.gelatoapis.com/v3/products/{productUid}/cover-dimensions?pageCount=N&measureUnit=mm`
returns the whole geometry, per product and per page count, for soft and hard
alike. So:

- A `CoverGeometry` type: the named boxes above, in millimetres. Soft and hard
  are the same type; a softcover simply has no joints and no wrap.
- `coverDimensions(productUid, pageCount)` in `lib/photobook/gelato.ts` returns
  one, or null.
- `render.ts` lays the cover out from a `CoverGeometry` rather than from
  `spec.size` and `spineWidthMm`. The softcover output must be unchanged where
  the numbers agree — assert it, do not assume it.
- **A local fallback, because AGENTS.md requires that no feature needs a paid
  account to develop or test.** With no key, compute the geometry from
  constants — and correct them while doing so: Gelato adds 4 pages before
  computing a spine, and its own relationship is exactly
  `spine = 0.24 + 0.155 * ((pages + 4) / 2)` mm, which reproduces every measured
  row. `paperCaliperMm` becomes about 0.155, not 0.115.
- Cache the answer on the order rather than fetching per render.

## Acceptance

- A 52-page 200 x 200 softcover renders a spine of 4.58 mm, not 3.22 mm, both
  with a key and without one.
- A 280 x 280 hardcover renders wrap, both joints and a 278 x 286 board panel,
  and its media box is 618 x 326 at 56 pages.
- `npm run photobook -- --size large-square --guides` produces a cover a person
  can check, and somebody looks at it. A drawing is the one output no test can
  check — see the `check-a-drawing` skill.
- Blocks B865: nothing may be sent to a printer before this is right.
