---
id: B740
title: The figures a book prints on its chapter dividers are missing from the preview, so the switch looks broken
type: ISSUE
priority: high
complexity: low
area: photobook, preview
found: "2026-09-07T00:00:00Z"
merged: "2026-09-07T12:48:26Z"
completed: "2026-09-07T13:14:20Z"
---

# B740 — The figures a book prints on its chapter dividers are missing from the preview, so the switch looks broken

## Why

Reported from the live site: *"I tried the figures, I don't see any."*

They are there — in the PDF. B727 added `includeFigureMarks`, which draws the
party at the foot of every chapter divider, and `drawPage`'s `"chapter"` case
in `lib/photobook/render.ts` does exactly that. What it did not do is teach
the *other* renderer, so `pageHtml`'s `"chapter"` case in
`lib/photobook/preview.ts:405` draws the country, the dates and the stats and
no figures at all.

So the switch is on, the book would print them, and the only thing the owner
can look at says nothing happened. That is precisely the failure
`lib/photobook/charts.ts` opens by warning about — "compute once, render
twice", and when the two drifted "the composer showed a page the printer would
not produce". The title page and the colophon already draw figures in both
renderers (`travellersSvg` is imported and used twice in `preview.ts`), so the
one missing call is the whole of it.

## Work

- `preview.ts`'s chapter case draws `travellersSvg` at the foot, positioned to
  match `render.ts`'s box.
- Check the other direction too: anything else B727 or B703 added to one
  renderer and not the other.
- A test that fails when a page kind draws figures in one renderer and not the
  other, if that can be written cheaply against the two outputs.

## Acceptance

- Turning the figures on shows them on the chapter divider in the composer's
  preview, in the same place the PDF puts them.
- Checked by looking, per `check-a-drawing`: the preview page and the
  rasterised PDF page side by side.

## Findings (2026-09-07)

The missing call was real, and it was the smaller half.

**First: the chapter case.** `preview.ts` now draws `travellersSvg` at the
foot of a chapter divider, matching `render.ts`'s box. `test/photobook-travellers.test.ts`
gained a test that counts pages carrying a party against drawings in the
preview HTML, so the next page kind that grows figures and forgets the preview
fails there rather than on somebody's order page. Removing the fix makes it
fail (`expected 2 to be 4`), which is how it was checked.

**Then, looking at it: the figures had never been visible in the preview at
all.** Not on the chapter divider, not on the title page, not in the colophon.
`travellersSvg` set `height:${pct}%` on the `<svg>`, and every caller positions
that absolutely — so the percentage resolved against a box whose own height is
`auto`, which is circular, which is zero. Both were 0 × 0 in the DOM. The PDF
drew them correctly the whole time, which is exactly what kept it hidden:
nobody looks at one page in both renderers unless they are checking for this.
That is `check-a-drawing`'s fourth trap almost word for word.

Fixed in the one function: `height:${pct}cqh`. `.sheet` is
`container-type:size`, so container units are a percentage of the printed page
whatever the boxes between are doing — and it is the unit the preview's type
scale already uses. Width follows from the viewBox.

**Verified by looking:** the demo journal's `asia-2023` in the composer — the
party now stands under "Switzerland" on the chapter divider and above the title
on the title page. Both were blank before, including on `main`.

`npm run verify`: all four passed (4471 tests).
