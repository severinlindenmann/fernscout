---
id: B1260
title: A trip with nothing recorded yet fills two phone screens with an empty sky, the whole world map and six zeros
type: ISSUE
priority: medium
complexity: medium
area: trip page, mobile
found: "2026-09-10T10:03:43Z"
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

- Decide, per module, what "nothing to show" should render. Absent is the
  cheapest answer and probably the right one for the map and for the zero tiles.
- The travel scene needs a person's eye rather than a rule — `/docs/branding/animation`
  is the bench for it. The question to answer there is whether a leg with no
  transport should draw a scene at all, and if it should, whether a figure
  standing in an empty sky is the drawing intended.
- A tile whose value is zero because nothing was recorded is different from one
  that is zero because the answer is zero. Only the first should disappear.
- Check the same page with one photograph, one cost and one coordinate — the
  point is the thin case, not the empty one.

## Acceptance

- A trip with one day, no coordinates, no costs and no photographs shows the day
  within the first screen at 390x844.
- No module on that page renders a frame with nothing in it.
- A trip that does have coordinates, costs and photographs is unchanged.
