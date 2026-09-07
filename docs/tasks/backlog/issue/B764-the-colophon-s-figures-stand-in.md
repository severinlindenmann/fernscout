---
id: B764
title: The colophon's figures stand in the middle of its own text
type: ISSUE
priority: high
complexity: low
area: photobook, print
found: "2026-09-07T00:00:00Z"
---

# B764 — The colophon's figures stand in the middle of its own text

## Why

Reported from the live site straight after B756 fixed the title page: *"on the
last side my figure right now is also overlapping with the text"*.

The same fault, in the one other place the party is drawn, and untouched by
B756 because that ticket was about the title page. `pageHtml`'s `"colophon"`
case (`lib/photobook/preview.ts:383`) puts the figures at `bottom:52%` — the
middle of the page — while the colophon's own text block is `.copy` with
`justify-content:flex-start`, so the words start at the *top* of the content
box and run down into them.

It is not new. It has been wrong since the colophon first drew figures, and
nobody saw it because they were 0 × 0 until B740; the first person to look at a
visible one is the person who reported it. The PDF is nearer the mark — the
figures clear the eyebrow by about 5 mm — but it is the same guess, and 5 mm
is coincidence rather than design.

## Work

- The preview draws the party inside the colophon's own block, above the
  heading, the way B756 did on the title page — the browser then does the
  arithmetic and overlap is impossible.
- The PDF places them off the block's own top (the eyebrow's baseline plus its
  cap height) rather than at a fraction of the page.
- Not doing: anything to the chapter divider, whose figures sit at the foot of
  a page with room below the text.

## Acceptance

- The last page of a book with five figures shows them clear of the colophon,
  in the preview and in the PDF.
- Checked against the demo journal, per the reporter's own request — a first
  visit to `example/asia-2023`, which has a party of five.
