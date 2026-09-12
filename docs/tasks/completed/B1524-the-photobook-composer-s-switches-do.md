---
id: B1524
title: The photobook composer's switches do not match what they remove, and the cover is never shown
type: ISSUE
priority: high
complexity: medium
area: photobook composer
found: "2026-09-11T19:54:57Z"
merged: "2026-09-11T19:56:05Z"
---

# B1524 — The photobook composer's switches do not match what they remove, and the cover is never shown

## Why

Reported by the owner from a real book (a trip of 47 photographs), as a list of
things that read as broken:

- **The cover is not in the preview.** The strip opened on the title page, so
  somebody who had just chosen a cover photograph had nowhere to see it. The
  preview draws every interior page and never the book's own face.
- **"Draw the ways you travelled" appeared to do nothing, and its page could
  not be removed.** `draftsForBack` printed the transport page whenever any day
  recorded how it moved; `includeVehicles` only added drawings *on* it.
- **"Include the cost summary" removed only part of the money.** The costs page
  went; the spend-against-budget chart stayed, under `includeCharts`.
- **"Include who travelled" also removed the walking figures**, which the label
  never said (`buildBookSource` empties `figures` with `travellers`).
- **The settings card's rows overlapped.** At 20rem the format select
  (`Quadratisch, 20 × 20 cm`) was wider than the space a `shrink-0` value was
  left, and sat on top of its own label; the two footer links wrapped into a
  paragraph of underlined prose.
- **The arrow keys did nothing on a desktop.** `useSpreadKeys` scrolls the
  strip on `x`; above 620px of frame B1486 wraps the spreads into a grid that
  flows down the document, so there was nothing to scroll sideways.
- **"Skip the rest — let the book decide" is offered on the last step**, where
  there is no rest to skip and it sits beside a button that opens the book the
  person has just finished deciding.

Found while fixing the above: **a stored arrangement from an older version
bricks the composer silently.** `PhotobookPageContent`'s restore comment says
an old arrangement is ignored rather than merged; the code merged it. A saved
`size: "square-210"`, a format the catalogue no longer offers, was restored,
posted, refused by `parseOptions` on the server, and the frame stayed empty for
ever with nothing said.

## Work

- The front cover, drawn from `CoverPlan` at the head of each volume's strip
  (`coverHtml` in `lib/photobook/preview.ts`), with the same knocked-out title
  band `drawCoverPage` paints — `COVER_BAND_MM` now lives in `coverGeometry.ts`
  so both read one number.
- `includeVehicles` gates the transport page itself, not only its drawings.
- `includeCosts` also removes the spend chart; `includeCharts` still adds no
  page on its own, so neither switch gains pages.
- Labels: names says "names and figures", vehicles says it is a page.
- The settings column is 24rem and a row's label gives way, never its value.
- `useSpreadKeys` asks the document which way it scrolls and what is carrying
  the scroll, rather than trusting the `axis` the view was mounted with.
- The skip link is hidden on the summary step.
- The restore path runs `parseOptions` and falls back to the default book.

Not doing: **"Include the writing" leaves the day's heading and date on the
page**, which is what made it read as dead on a photo-heavy trip. That is
deliberate (`plan.ts`: "Text off still leaves a dated page in front of each
day") and a change to it is a separate decision.

## Acceptance

- The composer's first tile is the cover, with the chosen photograph on it, at
  390 and at 1280.
- Turning the transport switch off removes the "how we travelled" page.
- Turning the cost switch off removes the costs page *and* the spend chart.
- At 1280 the settings rows each fit on one line and the arrow keys move the
  grid.
- A `localStorage` arrangement naming a size that no longer exists opens on a
  book that plans, not an empty frame.
