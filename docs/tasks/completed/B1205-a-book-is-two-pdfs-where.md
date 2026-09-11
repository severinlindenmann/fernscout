---
id: B1205
title: A book is two PDFs where the printer wants one, cover first
type: ISSUE
priority: high
complexity: medium
area: photobook, gelato
found: "2026-09-10T04:40:00Z"
merged: "2026-09-10T04:31:00Z"
---

# B1205 — A book is two PDFs where the printer wants one, cover first

## Why

The owner uploaded the interior to Gelato's own uploader by hand — the first
time anybody had — and it answered:

```
Product requires exactly 45 pages, while PDF contains 44 pages
Product requires that page 1 would be exactly 409.81 x 206.0 mm.
  Page size in provided PDF is 206.0 x 206.0 mm.
```

Both complaints are one complaint: **page 1 is missing, and page 1 is the
cover.** 45 = 42 pages of book + 2 blank leaves (B1173) + 1 cover — the same
`pageCount + 3` the API had already been measured to want. The two surfaces
agree with each other and we were the odd one out.

Their own template said so all along and this repository had it in writing:
"each is 31 pages: one cover page, then thirty interior pages"
(`docs/providers/gelato-templates/README.md`). One file.

Found the only way it could be: the API sums two files and never complains
about their arrangement, so nothing before a manual upload could have shown
this.

**A second fault surfaced with it.** The cover Gelato demanded is 409.81 mm
wide; ours was 408.72. `applyRealCoverGeometry` fetches Gelato's own figure —
but only in `lib/photobook/build.ts`, never in `scripts/photobook.mts`. So the
CLI drew a computed spine and the button drew Gelato's, and a cover checked in
the CLI was a millimetre narrower than the one ordered — on the axis where a
millimetre wraps the front image around the corner. The comment at the top of
`build.ts` says these two must never differ.

## Work

- `renderBook` in `lib/photobook/render.ts`: one document, cover page first,
  then every page, then the two leaves. `renderCover`'s drawing is split into
  `drawCoverPage` so both can use it.
- Written **beside** the two halves, not instead of them. The halves are what
  the API submits today and what somebody takes to a different printer; the
  combined file is what a person uploads to Gelato by hand.
- The CLI fetches the real cover geometry, like the button.

## Acceptance

- The combined file is `pageCount + 3` pages, its first page the cover sheet at
  Gelato's own dimensions and the rest the trimmed page.
- The CLI and the button draw the same cover.
- `npm run verify`.

## Evidence

Built on the live instance from `severin/algarve-2026`:

```
pages:      45
page 1 mm:  409.81 x 206.0    <- exactly what the uploader demanded
page 2 mm:  206.0 x 206.0
```

Against Gelato's own 28-page template, page for page: 31 pages, page 1
1158.58 x 583.937 pt, page 2 square. Ours for a 28-page book is identical.

Still open: whether to submit **one** file to the API instead of two. Two is
measured to pass and is what ships; one is what their uploader wants from a
person. Worth settling, but not by guessing — it is one more prepress order.
