---
id: B628
title: The postcard signature area cannot carry the traveller figures
type: FEATURE
priority: medium
complexity: low
area: postcards, travellers
found: "2026-09-06T17:51:43Z"
started: "2026-09-06T19:00:27Z"
merged: "2026-09-06T19:15:50Z"
---

# B628 — The postcard signature area cannot carry the traveller figures

## Why

A postcard's back has a signature area, and the journal already knows what the
travellers look like — the walking figures at
`/api/v1/<user>/travellers/preview`, drawn from the vocabulary in
`lib/photobook/travellers.ts`. They appear in a photobook and not on a
postcard, which is the wrong way round: a postcard is the smaller, more
personal object.

## Work

- Offer the traveller figures beside the signature on the postcard back, off by
  default and switched on per order.
- Use the existing figure rendering; do not draw a second set for print.
- Watch the safe area — `docs/branding/print` is the bench that shows it.

## Acceptance

- With the option on, the figures for the people on the trip print beside the
  signature and stay inside the safe area.
- With it off, the back is exactly as it is now.

## Notes from the build

**Whose figures, and where a likeness lives.** There is no per-person
likeness anywhere in this codebase — not for the owner, not for anybody in
`people:`, not for a buddy who joined by link. A traveller's appearance lives
only in one place, `Trip.travellers` (the `travellers:` block in `trip.md`,
`Figure[]`), addressed to the *trip as a whole*, falling back to the
journal's own default party (`UserConfig.travellers`) for a trip that says
nothing. `for:` on a figure is a loose tag toward an address in `people:` and
is never read back to filter or match — every reader (`lib/site.ts`'s hero,
`lib/photobook/source.ts`'s title page, and now this) draws the *whole*
array or nothing. So a buddy is never separately drawable, and this ships the
same party the photobook already prints rather than inventing a second
concept of "who is on the trip, visually". `lib/postcard/entry.ts`'s
`travellerPartyFor(trip)` is the one function that resolves it, reusing
`partyFor` from `lib/travellers/parse.ts` and filtering out the empty
placeholder the same way `lib/photobook/source.ts` does — a trip nobody has
described draws nobody, never a default couple.

**What was reused, not redrawn.** `drawTravellers` and `travellersSvg` from
`lib/photobook/travellers.ts`, unchanged. That module already writes through
`lib/postcard/pdf.ts`'s own `PdfBuilder` (photobook and postcard share one PDF
writer), so no new rendering path was needed at all — `lib/postcard/render.ts`
just calls it with a box in its existing point-space and a
`(x, y) => [x, y]` identity `toPdf`. The browser preview reuses
`travellersSvg` the same way `lib/photobook/preview.ts` already does.

**Geometry**: `lib/postcard/spec.ts`'s new `FIGURES_AREA` anchors the box to
the divider (not to the signature text), so a short "Us" and a long
"Sev & Ana & Theo" need no different geometry. `lib/postcard/preview.ts`'s
`backLayout().figures` is the same box, in the same constants, for the
on-screen mock — one source, two spellings, as the codebase already asks for.

**Got eyes on it.** Rendered a real PDF (`renderPostcard` with a 3-person
party, `guides: true`) and rasterised it with `pdftoppm` at 300dpi. The three
figures sit beside "Sev & Ana & Theo", well clear of the trim edge, the
divider and the address/stamp blocks. With `figures` absent or `[]`, the PDF
bytes are byte-for-byte identical to a card with no `figures` field at all
(now a test — see below).

**The switch**: `OrderPayload.figures?: boolean` (absent/false = today's
back), `updateOrderFigures()` in `lib/postcard/orders.ts`, and
`app/[user]/postcards/[id]/figures/route.ts` — the same shape as B627's
`crop` route: owner cookie only, refuses `Authorization` outright, refused
once the order leaves `draft`. A plain form checkbox (like `message`, not a
`fetch`), since a toggle needs no JavaScript. The control is hidden entirely
when the trip has no described party — there being nothing to turn on.

**Test**: `test/postcard.test.ts`, `describe("traveller figures on the back")`
— absent/`[]` renders byte-identical to no field at all, a real party adds
many more PDF fill operators than the baseline, and (a pure geometry check)
the figures box's four edges all fall inside the A6 safe rectangle and never
cross the divider.

**Verify**: `npm run verify` — build, tsc, eslint (0 errors, pre-existing
warnings only), vitest (304 files, 3940 passed) — all green.
