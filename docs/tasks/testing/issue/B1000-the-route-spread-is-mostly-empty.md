---
id: B1000
title: The route spread is mostly empty for a compact trip
type: ISSUE
priority: medium
complexity: medium
area: photobook, route map
found: "2026-09-08T17:15:27Z"
started: "2026-09-08T21:49:15Z"
merged: "2026-09-08T22:09:22Z"
---

# B1000 — The route spread is mostly empty for a compact trip

## Why

Four days round the Alps prints a two-page route spread that is almost
entirely empty grid. Two of twenty-eight pages, and it reads as broken.

Two faults were found and fixed (see `routeView` in `lib/photobook/plan.ts`):

- The padding floor was 6 map units — about 2.2 degrees of longitude *per
  side*. The Alps trip spans 0.6 degrees, so the frame was twelve times the
  route's own width and the journey printed as a thumbnail squiggle. The floor
  is now 1.2, and the route fills about half the spread's height instead of a
  sixth.
- `centreAwayFromFold` could slide the frame until a stop reached its *edge*,
  so for a route far narrower than its frame the winning candidate put the
  fold beyond the last stop and the whole journey landed on one page with a
  blank sheet facing it. The fold now stays inside the journey.

**What is left is geometry, and it needs a decision rather than a patch.**

A spread is 2:1. A compact, north-south journey — passes in the Alps, a week
in one valley — cannot fill it: forcing the frame to 2:1 means expanding it
sideways, so the route occupies about an eighth of the spread's width however
it is placed. And `lib/worldLand.json` has no coastline at that zoom, so the
surrounding space is bare graticule rather than land.

There is also a residual cost to the fix above: with the fold now inside the
journey, a stop can land in the gutter and lose its label. On the Alps trip
Andermatt does exactly that. The band (8% of the frame) is wider than the
largest gap between stops, so no fold position inside this route is clean.

## Work

**Decided: one page instead of two for a compact route.** Implemented in
`lib/photobook/plan.ts`:

- `routeFitsOnePage(route, pageAspect)` computes the route's own padded
  width/height (the same arithmetic `routeView` uses) and compares its aspect,
  in log space, against one trim page's own aspect versus a spread's
  (`pageAspect * 2`) — whichever it sits closer to wins. This generalises
  across book sizes rather than hard-coding "square": a portrait book
  (210×280) gets a different, correct threshold automatically.
- `draftsForFront` calls it and emits a single `{ kind: "route", half: "full" }`
  draft instead of the `"left"`/`"right"` pair when it says yes.
- `routeView` takes two new optional parameters — `targetAspect` (default 2,
  the spread's own shape) and `hasFold` (default true) — so a `"full"` page
  can ask for its own trim aspect and skip `centreAwayFromFold`, which has
  nothing to dodge on a page with no facing half.
- `mapProjector` and `mapClipMm` grew a third `half` value, `"full"`: one trim
  page's own width instead of two, no offset, bleed on all four edges (no
  spine to hold back from) via `bleedBoxMm`.
- `render.ts`'s `drawRoutePage` and `preview.ts`'s `routeSvg` both take the
  page's own `side` (not `half`) for the content box now, since the two
  stopped being interchangeable the moment a page could be unpaired.

**The gutter-loses-a-label fault is fixed too, generically** — not only for
the compact case the single page now sidesteps entirely, but for any spread
where a stop's dot still lands in the fold band. `routeLabelPlacements` gained
an optional `ownerEdges` parameter: which page *claims* a stop (its own trim,
gutter included) is now separate from where a label may *anchor* (the safe
content box, as before). Previously a stop outside the content box belonged to
neither facing page and was silently dropped; now it belongs to whichever
page's trim contains it, and is drawn there, pushed back inside the safe
margin. A second, smaller bug turned up building this: the "place it left of
the dot" branch assumed the dot itself was already inside the safe box, so for
a claimed-by-trim-only stop it could still emit an anchor past the content
box's edge. Fixed by doing the left/right arithmetic from the dot's position
*clamped* into the box, not the box-violating position itself.

**Not done, and not needed now:** the other two options (a terrain/place-name
layer for close-zoom land, and dropping the route spread outright for short
trips) — a single well-fitted page fills the reader's eye with the actual
journey, which was the complaint.

## What was checked

Two fixtures, both driven through the *real* planner and PDF renderer
(`planBook` + `renderVolume`, not a mock) via a throwaway script, rasterised
with `pdftoppm` and looked at:

- **Compact**: the four-stop Alps trip from B914 (Susten Pass, Grimsel Pass,
  Domodossola, Andermatt — 0.6° of longitude). On a square (200×200mm) book
  this now plans exactly one `"route"` page (`half: "full"`), which fills the
  whole page with the route large enough to read, and names all four stops —
  including Andermatt, which used to fall in the gutter and lose its label.
- **Sprawling**: New York → Chicago → Denver → Los Angeles, deliberately wide
  east-west and narrow north-south (a shape a 2:1 spread suits far better than
  a square page). This still plans a `"left"`/`"right"` pair; the coastline
  and route line run across the fold without a step, and all four stops are
  named, split correctly across the two pages.

Also checked: a sub-degree square-book trip and a 12°-plus sprawling one both
still round-trip through `npm run verify` (build, tsc, eslint, 5821 vitest
tests including new ones for this ticket, knip) with no failures.

## Acceptance

- A four-stop, sub-degree trip prints a route the reader can read, with every
  stop named, and no page of bare grid. **Met** — see the Alps render above;
  `test/photobook.test.ts` also asserts this at the plan level (one page,
  `half: "full"`, four points).
- Somebody looks at it. A drawing is the one output no test can check — see
  the `check-a-drawing` skill. **A person should still look.** I rendered and
  visually inspected both the compact Alps page and the sprawling US spread
  (rasterised PDF pages, not a screenshot of the web preview) and they read
  correctly to me, but I built the fix — a second, independent pair of eyes on
  the actual printed page (or the `/[user]/photobook/preview` route on a real
  trip) is the honest bar this line sets, not a substitute for it.
