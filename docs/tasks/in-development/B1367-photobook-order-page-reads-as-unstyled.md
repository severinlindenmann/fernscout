---
id: B1367
title: Photobook order page reads as unstyled text, not a Fernscout page
type: CHORE
priority: low
complexity: low
area: photobook, design
found: "2026-09-10T18:28:19Z"
started: "2026-09-11T04:23:05Z"
session: 96a5b964-fad1-4616-9124-a01eabbd8a46
claimed: "2026-09-11T04:23:05Z"
---

# B1367 — Photobook order page reads as unstyled text, not a Fernscout page

## Why

`/<user>/photobooks/<id>` (`app/[user]/photobooks/[id]/page.tsx:205-258`) is a
bare `<h1>`, a paragraph, and an unstyled `<ul>` of underlined links, on a
plain background — see screenshots in this ticket's originating conversation.
The owner compared it directly against `/<user>/postcards/<id>`
(`app/[user]/postcards/[id]/page.tsx`), the equivalent order/confirmation page
for the other print product, which uses `PageHeader`, a
`max-w-3xl`/`max-w-5xl` main with proper padding, `font-display` headings,
figure/figcaption for the photograph, cards/sections with borders and
rounded corners for state panels (e.g. the yellow status box at line 361),
and consistent `text-navy-*` colour steps — and asked for the photobook page
to read as the same product rather than plain text.

## Work

Restyle `app/[user]/photobooks/[id]/page.tsx` (and, if it still exists after
B1365/B1366, whatever remains of the "done" panel in
`PhotobookPageContent.tsx`) to match the postcard order page's visual
language: `PageHeader`, consistent `max-w-*` container and padding,
`font-display` for the `<h1>`, the download links and print/status section
laid out as distinct visual blocks (cards or sections with spacing) rather
than a raw list, and the brand's colour and spacing tokens throughout. Use
`apply-the-brand` for the palette and `check-a-drawing` (or
`/docs/branding`) to verify the result rather than judging it from source.

Depends on / should land after B1365 (redirect straight here) and B1366
(drop the interior/cover links) — restyling a page whose content is about to
change is wasted work if built first; sequence Work accordingly, or fold this
ticket's content changes in from those two rather than redoing them.

Not touching: the postcard order page itself, or the print/status logic —
only layout and visual treatment of the photobook order page.

## Acceptance

`/<user>/photobooks/<id>` uses `PageHeader`, brand typography and spacing,
and a card/section treatment for its content blocks, and reads as visually
consistent with `/<user>/postcards/<id>` when viewed side by side (checked in
a real browser at both desktop and ~390px width — `test-in-a-browser`).
`npm run verify` passes.
