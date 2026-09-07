---
id: B737
title: The travel scene's vehicles exist only on the web, so a book cannot show how a leg was travelled
type: FEATURE
priority: low
complexity: medium
area: photobook, print
found: "2026-09-07T00:00:00Z"
started: "2026-09-07T12:59:53Z"
session: cd599e8c-dde0-4a5b-9f06-d5795febbb72
claimed: "2026-09-07T12:59:53Z"
---

# B737 — The travel scene's vehicles exist only on the web, so a book cannot show how a leg was travelled

## Why

Asked for while B727 was being built: the owner wanted the things at
`/docs/branding/animation` and `/docs/branding/travellers` offered in the book
somewhere — "a header, a footer, somewhere we could place some funny
animations".

Half of that shipped in B727. The **figures** were already drawable on paper
(`lib/photobook/travellers.ts` spells `lib/travellers/shapes.ts` as PDF), so
`includeFigureMarks` now walks the party in at the foot of every chapter
divider.

The **vehicles** are the half that did not, and the reason is real rather than
a scoping decision. The travel scene is React components under
`components/animation/` — `Vehicle.tsx` and the rest — drawn as SVG for a
browser, with transforms, gradients and opacity. The book's writer takes path
data and flat fills (`lib/postcard/pdf.ts` has no alpha and no gradients), and
`lib/travellers/shapes.ts` exists precisely because somebody did that work once
for the figures: one geometry, two spellings, with a test holding them
together.

So a car at the top of a transport page is: a `shapes.ts`-shaped extraction of
the vehicle geometry, a `drawVehicle` beside `drawTravellers`, and the same
discipline about not forking the drawing. `TRANSPORT_MODES` already says which
vehicle a leg wants, and the transport page already exists with room on it.

## Work

- Extract the vehicle geometry the way `lib/travellers/shapes.ts` was
  extracted: paths and flat colours, in one viewBox, imported by both the
  React component and a new print spelling. Not a second copy — the fork is
  the thing that goes wrong, and B497 is the record of it going wrong.
- `drawVehicle(page, place, box, mode)` in `lib/photobook/`, beside
  `drawTravellers`.
- Draw it on the transport page, per mode, from `TRANSPORT_MODES`.
- Not doing: animation. Paper does not move, which is also why the figures
  stand still there (`lib/photobook/travellers.ts` says so).
- Not doing: a switch of its own until it is drawn. Whether this rides on
  `includeFigureMarks` or gets its own tile in the first-book flow is a
  question for when there is something to look at.

## Acceptance

- A trip with a car leg prints a car on its transport page.
- The geometry has one home, and a test fails if the web and print spellings
  diverge — the same shape as `test/photobook-travellers.test.ts`.
- Looked at, per `check-a-drawing`, against `/docs/branding/animation`.
