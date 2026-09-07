---
id: B733
title: The landing page and the helper door are flat cream, while the brand they are built from has paper, panels and a yellow that leads
type: FEATURE
priority: medium
complexity: medium
area: landing, agent, brand
found: "2026-09-07T13:20:00Z"
started: "2026-09-07T12:20:26Z"
session: ccdd5120-0eb0-4abf-b76e-a6fd8e5005d8
claimed: "2026-09-07T12:20:26Z"
---

# B733 — The landing page and the helper door are flat cream, while the brand they are built from has paper, panels and a yellow that leads

## Why

The owner pointed at a mockup of the helper wizard — a private artifact drawn
in an earlier session — and asked for `/` and `/agent` to look closer to it.
Reading its CSS, the interesting part is what it is *not*: it invents nothing.
Its palette is this repository's palette, hex for hex, and its two fonts are
the two already loaded in `app/layout.tsx`. Every difference is in how the
brand is applied, which makes this a task about application rather than a
redesign, and keeps it inside `apply-the-brand`'s rule that a new component
uses one of the six hues rather than a seventh.

Four differences carry nearly all of the effect:

- **Ground and panel.** The mockup puts a warm paper behind cream cards, so
  every card, field and pill has an edge. The site paints one cream everywhere,
  so a card is only a border — nothing has depth and the page reads as a
  document rather than a thing. The two-step already exists in the palette:
  `cream-100` as ground, `cream-50` as panel. No new token.
- **Yellow leads.** The mockup's primary button is `yellow-400` with a
  `yellow-600` edge and `yellow-950` text — the waymark colour doing the job
  the waymark does. The landing's primary is `navy-900`, so the brand colour
  appears nowhere on the first screen of the site it belongs to.
- **A mono voice for machine things.** Kickers, labels, pills, ids and counts
  are monospace, uppercase, letter-spaced. It is what makes the mockup read as
  an instrument. There is no mono token here at all — Tailwind's default stack
  is used raw in one place.
- **Structure you can see.** Section headings sit on a rule, pills carry
  status, and a card's border colour means something.

## Work

- **A mono token**, beside `--font-display` and `--font-sans` in
  `app/globals.css` and loaded in `app/layout.tsx` the same way. The mockup
  uses IBM Plex Mono; the argument for it over the system stack is that the
  system stack is a different face on every machine, and this one carries
  small uppercase letter-spaced text where that shows.
- **Ground and panel on `/` and `/agent`**: `cream-100` behind, `cream-50` on
  cards. Check the header and footer, which currently assume one ground.
- **The primary call to action becomes yellow** on both pages. Text on it is
  `navy-900` or `yellow-950` and nothing else — that is a measurement, not a
  preference, and `/docs/branding/identity` has it.
- **Kickers, pills and section rules** as shared pieces in
  `components/LandingSections.tsx` rather than as classes repeated per section.
- Keep every contrast obligation: small text is held to AAA here because the
  readers are past sixty and often outdoors. `yellow-600` is a fill and never
  a text colour on cream; focus stays `blue-500`.

Not doing: the mark, the wordmark, the favicon or the OG image — none of them
change. No seventh hue. No change to any page other than `/` and `/agent`.

## Acceptance

- `/` and `/agent` show a paper ground with cream panels on it, and the
  primary action on each is yellow.
- No raw hex is introduced; every colour is an existing token.
- `/docs/branding/identity` still renders, and nothing there has moved.
- Checked at 390px, and against the contrast floors the bench publishes.
- The dark-mode question is answered explicitly one way or the other in this
  file before it is closed — the mockup has a full dark palette and the site
  may not.
