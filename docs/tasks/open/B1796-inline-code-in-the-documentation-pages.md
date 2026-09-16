---
id: B1796
title: Inline code in the documentation pages is invisible against the dark background
type: ISSUE
priority: medium
complexity: low
area: docs, branding, dark mode
found: "2026-09-15T11:54:03Z"
---

# B1796 — Inline code in the documentation pages is invisible against the dark background

## Why

Every `code` span inside a documentation page renders at a colour with almost no
contrast against the dark background. The text is in the DOM and the page reads
correctly with a screen reader or in `innerText` — it is simply not visible.

Caught by a browser capture at 390px while verifying B1751's new
`/docs/extract` page. The reason it is filed rather than fixed on that branch is
that the same defect appears on `/docs/helper`, which predates it — so this is
the docs renderer's own styling, not something the new page introduced.

The effect is worst exactly where it matters most. On `/docs/extract`:

> "That is the only place this software reads a location from — **[invisible]**
> pulls **[invisible]** straight out of a staged file's EXIF"

The two invisible spans are `lib/extract/analyse.ts` and `lat`/`lng`. A reader
sees a sentence with holes in it and no way to guess what belongs there. On
`/docs/helper` the same thing swallows file paths, JSON keys and currency codes.

Captures from the run that found it:
`/tmp/extract-capture/docs-extract-390.png` and `docs-helper-390.png`, beside
`docs-extract.json`, whose `innerText` contains every word the screenshot is
missing — which is what proves it is a contrast problem rather than a rendering
one.

## Work

Find where the docs renderer styles inline code and give it a foreground that
clears the contrast floor on the dark surface it actually sits on. The palette
is in `app/globals.css` and `apply-the-brand` names which tokens may carry text
— two of them are documented as fills rather than text colours, and this is
probably one of those used in the wrong slot.

Check the light theme at the same time. A token that fails on dark may have been
chosen because it looked right on cream, so fixing one without looking at the
other risks trading the bug rather than closing it.

Not in scope: changing the docs mechanism, or the content of any page.

## Acceptance

- Inline code is legible on every documentation page in both themes, checked in
  a real browser at 390px and 1280px with the capture kept.
- The check covers at least `/docs/extract` and `/docs/helper`, since those are
  the two confirmed.
- Whatever token is chosen is one `apply-the-brand` says may carry text, rather
  than a fill used as a foreground.

## Related

Found while verifying B1751. Not introduced by it — `/docs/helper` has the same
defect and predates that branch.
