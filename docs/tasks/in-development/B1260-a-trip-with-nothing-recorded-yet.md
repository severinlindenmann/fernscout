---
id: B1260
title: A trip with nothing recorded yet fills two phone screens with an empty sky, the whole world map and six zeros
type: ISSUE
priority: medium
complexity: medium
area: trip page, mobile
found: "2026-09-10T10:03:43Z"
started: "2026-09-11T15:47:57Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T15:47:57Z"
---

# B1260 — A trip with nothing recorded yet fills two phone screens with an empty sky, the whole world map and six zeros

## Why

This is what a journal looks like at the moment its owner finishes the wizard,
writes their first day and publishes it — the state every new journal passes
through, on the screen most of them will be on. Measured at 390x844 on
fernscout.ch/test-mobile, 2026-09-10:

| From the top | Height |
| --- | --- |
| title, dates, "The trip is over", Last day, From the start | 296px |
| **the travel scene** — flat `bg-sky-300` with a gradient over it and the traveller figure tucked in the bottom-right corner. No ground, no vehicle, no hills, no skyline: the DOM under it is `bg-sky-300`, a gradient, and the party, and nothing else | 200px |
| **the map** — the entire world, every continent, no marker anywhere on it | 190px |
| **six stat tiles**: Day on the road 1 · Countries 0 · Stops 0 · Photos & videos 0 · Total so far CHF 0 · Average per day CHF 0 | 400px |

Nearly 800px — two phone screens — of modules reporting that they have nothing
to report, before the reader reaches the day that was actually written.

Each one is defensible alone and together they read as a page that failed to
load. The empty sky in particular looks like an image that did not arrive; the
world map looks like a map that lost its pin. A person showing their new journal
to somebody is showing them this.

AGENTS.md already states the principle for the capability switches: *"every
optional capability … must be **absent** rather than broken when disabled."* The
same argument applies to a module with no data.

## Work

Built in `components/TripHero.tsx` and `lib/tripView.ts`, on branch
`b1258-ui-remainder`.

- **Correction to this ticket's own wording**: what it calls "the travel
  scene" (`components/TripHero.tsx:326`, then) is not `TravelScene.tsx` — that
  component is the animated leg-by-leg scene on `/docs/branding/animation` and
  is never rendered on the trip hero at all. What's here is a flat
  `bg-sky-300` placeholder standing in for a missing cover photograph, nothing
  to do with transport or a leg. There is no bench for it and B1260's "check
  it at `/docs/branding/animation`" instruction does not apply.
- **Per-tile rule applied**: a value is absent to the DOM, not a zero, exactly
  when zero means "nothing was ever recorded" rather than "the answer is
  nought":
  - **Cover/photo panel** — absent whenever `coverSrc` is empty. The whole
    grid column (image + gradient + `Travelers` figure) is gone rather than
    a flat sky under a walking figure; the grid collapses to one column. The
    traveller figures live only here — there is no fallback rendering of them
    elsewhere when the cover is absent, since the masthead's own
    `travellerNames` text line already says who was on the trip in words.
  - **Map** — absent whenever no day and no `current` position is plottable
    (`isPlottable` from `lib/mapFrame.ts`, reused rather than a new coordinate
    check). Present as soon as one coordinate exists anywhere on the trip.
  - **Countries / Stops tiles** — absent whenever `stats.places === 0`, which
    only happens when no day carries a coordinate at all (a trip cannot
    genuinely visit zero of its own stops, so a real zero never occurs here).
  - **Photos & videos tile** — left alone, unconditionally rendered. A trip
    that genuinely has no photographs yet showing "0" is real information,
    per this ticket's own Why section, and stays.
  - **Total so far / Average per day tiles** — `lib/tripView.ts` now only
    populates `stats.totalSpend`/`stats.spendPerDay` when
    `costs.items.length > 0` (covers preparation and on-the-road costs both).
    `TripHero` already hid these two tiles on `undefined` for B353's dash
    case, so the same `undefined` gate now also covers "nothing recorded" —
    no second condition invented.
  - **Day on the road tile** — left alone; `tripDays` is never a real zero
    (minimum 1) so there was nothing to hide.
- **The cover-band judgement call, flagged for a person's eye rather than
  settled**: chose to make the whole photo panel absent (not a smaller or
  differently-styled placeholder) when there is no cover photograph, rather
  than keep some placeholder drawing. Reasoning: a flat colour band under a
  walking figure reads as a broken image regardless of size or colour, and
  the traveller identity it also carried is already said in words one line
  above (`hero.travellers`). This is a defensible choice, not a proven one —
  say if a placeholder illustration (rather than nothing) is wanted instead.
- Verified against `test/trip-summary-unconverted.test.tsx` (a real cost item
  in an unrated currency — `stats.totalSpend` must still render as `0`/dash,
  never disappear) and `test/push-optin.test.tsx`,
  `test/story-jump-label.test.tsx`, `test/story-day-permalink.test.tsx`,
  `test/world-map.test.tsx` — all 38 pass unchanged, so the thin-and-real
  cases (one photo, one cost, one coordinate) are unaffected.
- Not verified in a real browser against a genuinely empty trip — no such
  trip exists in the local `content/example` demo data, and building one
  would itself be new fixture content beyond this ticket's scope. The
  reasoning above rests on reading the component and the existing test
  suite, not on a screenshot of the empty state itself.

## Acceptance

- A trip with one day, no coordinates, no costs and no photographs shows the day
  within the first screen at 390x844.
- No module on that page renders a frame with nothing in it.
- A trip that does have coordinates, costs and photographs is unchanged.
