---
id: B737
title: The travel scene's vehicles exist only on the web, so a book cannot show how a leg was travelled
type: FEATURE
priority: low
complexity: medium
area: photobook, print
found: "2026-09-07T00:00:00Z"
started: "2026-09-07T12:59:53Z"
merged: "2026-09-07T13:21:37Z"
completed: "2026-09-09T16:45:02Z"
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

## Findings (2026-09-07)

Built, as the extraction the ticket described. The owner asked for it directly
— "two options, Transportmittel and Figures, on and off" — so it is a switch of
its own beside B727's figures rather than riding on it.

**One geometry, three spellings.** `lib/travel/vehicleShapes.ts` holds all
eight vehicles as `Shape[]`, the same type `lib/travellers/shapes.ts` uses.
`components/travel/Vehicle.tsx` is now one spelling of that rather than the
drawing itself — it renders the body through `shapesToSvg` and wraps each wheel
in the `motion.g` it always had, so the wheels still turn and the reasoning
about raked wings and which end the locomotive goes on moved with the shapes it
is about. `lib/photobook/vehicles.ts` is the other two, PDF and the preview's
SVG.

**What the extraction needed on the way.**
- `lib/photobook/shapes.ts` is new: the `Shape[]` → PDF painter, lifted out of
  `travellers.ts` now that a second thing wants it. `travellers.ts` imports
  `paintShapes` and is otherwise unchanged.
- `shapesToSvg` is exported from `lib/travellers/render.ts`.
- **A stroked circle drew nothing.** `attrs()` in that file emitted a stroke
  only for `kind === "path"`, so the bicycle's rim — a stroked circle — came
  out with neither fill nor stroke. Pre-existing; no figure happens to use one.
- **The plane vanished on paper.** Its fuselage is `#fffaf0`, which is the
  site's own cream against a sky and is invisible on a white page: the
  aeroplane arrived as a fin, two wings and nothing between them. `forPaper`
  in `lib/photobook/vehicles.ts` substitutes a darker cream, in the print
  spelling only, because the shape is right and the ink was wrong for that
  ground. Only looking at it would ever have found this.

**Where they go.** `ChartShape` gained a `vehicle` kind, so both renderers pick
it up from the one list they already walk — a bus lands on the transport page
in the PDF and in the composer from one decision about where it goes. One per
mode row, at the outer edge, sized by the mode's own proportions: a train is
three times a bicycle and drawing them the same width would say they are the
same thing. `walk` has no drawing and is skipped, exactly as the travel scene
skips it.

`includeVehicles` is off by default and optional in `parseOptions`, for the
same reason `includeFigureMarks` is. The tile is offered only where a day
records how it was travelled.

**Verified by looking:** all eight rendered from the extracted geometry at
200px; the transport page rasterised out of a real seven-day book with five
modes on it; and `/docs/branding/animation` in a browser, where the scene, the
wheels and the "Fernscout" titles are unchanged. No console errors.

`npm run verify`: all four passed (4529 tests). `npm run unused`: nothing of
this ticket's.
