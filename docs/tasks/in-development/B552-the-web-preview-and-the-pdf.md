---
id: B552
title: The web preview and the PDF renderer are two implementations of one layout
type: CHORE
priority: low
complexity: high
area: photobook, print
found: "2026-09-06T09:04:25Z"
started: "2026-09-06T14:20:15Z"
session: 6b9bf0a6-5ea8-4f27-bfcd-df5022696053
claimed: "2026-09-06T14:20:15Z"
---

# B552 — The web preview and the PDF renderer are two implementations of one layout

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Came out of the library search for B547 and is deliberately not part of it.

`lib/photobook/preview.ts` draws the book for the browser and the PDF renderer
draws it for the printer, from the same plan but through two separate bodies of
drawing code. B519 and B518 were both cases of the two needing the same fix, and
`graticuleStep()` was extracted precisely so one of them could not drift from the
other. That extraction is the pattern working; the duplication is still there.

A preview that is a second implementation can lie about the artefact, and the
whole premise of the composer is that it does not.

The alternative found while researching B547: render the book as HTML and CSS
once, and produce the PDF from that same markup with
[Paged.js](https://pagedjs.org/) or [Vivliostyle](https://vivliostyle.org/),
both of which implement the CSS Paged Media modules and target print
(Vivliostyle's CLI emits PDF/X-1a). The preview then *is* the book rather than a
drawing of it.

## Work

A spike first, not a rewrite. Take one page kind that is already hard — the
route spread, which has the gutter, the graticule and the culling — and see
whether it survives the round trip at print quality. The answer decides whether
this is worth the size of the change.

Weigh honestly: the current renderer works, is tested, and emits exactly the
bytes a printer wants. Replacing it buys one source of truth and costs a
dependency plus a headless browser in the PDF path.

**Not doing:** anything under B547. That ticket is the UI, and no library fixes
it.

## Acceptance

- A written recommendation with the route spread rendered both ways, and a
  decision to proceed or to close this.
