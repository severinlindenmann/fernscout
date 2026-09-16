---
id: B1812
title: The title page renders at a quarter the area of every other page in the preview
type: ISSUE
priority: high
complexity: low
area: photobook preview
found: "2026-09-16T18:10:56Z"
---

# B1812 — The title page renders at a quarter the area of every other page in the preview

## Why

Reported by the owner on 2026-09-16, looking at `/[user]/trips/ungarn-2026/photobook`
on a desktop screen: the Titelseite in the preview strip is a small box beside
spreads that are twice its size, and the book reads as though page one were an
afterthought.

The preview is an HTML document `renderPreview()` builds in
`lib/photobook/preview.ts` and `BookLevelView.tsx:304` drops into an
`<iframe srcDoc>`. Every page box takes its shape from one derived ratio
(`preview.ts:694`, trim plus bleed), so the aspect is right everywhere. The
fault is in how much row width a box may claim.

`spreadsOf()` (`preview.ts:353`) groups the title page alone, so it renders as
`.spread.solo`. Two rules then apply to it:

- `preview.ts:881` — `.spread.solo figure { flex:0 0 50% }`. Correct on a phone,
  where the container is a 96%-wide snap step and the lone recto should occupy
  half of it.
- `preview.ts:916`, inside `@media (min-width:620px)` — `.spread.solo` is given
  `calc(25% - .5rem)`, which is already exactly one interior page's width, since
  a normal `.spread` gets 50% and splits it between two figures
  (`preview.ts:794`, `:913`).

The desktop block never overrides the first rule, so the halving happens twice:
the title page draws at about 12.5% of the row against an interior page's 25% —
half the width, a quarter of the area.

## Work

Override the mobile rule inside the desktop media query, beside the
`.spread.solo` rule it belongs with, so the lone figure fills the container that
has already been sized correctly for it:

```css
body.bare:not(.read)[data-view="spreads"] .spread.solo figure { flex:1 1 0; }
```

Leave `preview.ts:881` alone — the swipe strip needs it.

One thing to settle while looking, rather than by reading: the report also says
the cover/back-cover pair sits at a different scale from the inner spreads.
Static reading of `coverHtml` (`preview.ts:639`) shows the cover using the same
non-solo rules as any interior spread, so it should already match, and the
complaint may be the tiny title page next to it making the pair look uneven.
Compare the computed pixel widths of a cover panel and an interior page in
devtools. If they differ, that is a second fault in `coverHtml` and gets its own
ticket rather than being folded into this one.

Not doing: any change to the print geometry. This is the on-screen preview only;
the PDF is unaffected.

## Acceptance

- At desktop width, a title-page figure and an interior day page in the same
  preview have the same computed width. Measured in a browser, on a trip that
  existed before this branch, not on a fixture written for it.
- The phone-width swipe strip is unchanged: the title page still occupies half
  its snap step.
- Screenshots at both widths, before and after.
