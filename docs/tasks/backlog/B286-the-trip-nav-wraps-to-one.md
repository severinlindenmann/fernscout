---
id: B286
title: The trip nav wraps to one row on one trip and two rows on another at the same width
type: ISSUE
priority: low
complexity: medium
area: header, nav, ui
found: "2026-09-04T12:50:19Z"
---

# B286 — The trip nav wraps to one row on one trip and two rows on another at the same width

## Why

Reported directly, comparing `/example/trips/japan-2027` and
`/example/trips/parks-2025`: at what should be the same desktop viewport, the
nav (`components/SiteNav.tsx`) shares line 1 with the title and chips on one
trip's pages and wraps to its own second line on the other's.

B170/B212 (`docs/tasks/testing/B170-…md`, `…B212-…md`) measured and accepted
that the trip-story header is two rows at desktop widths (the day-counter
`children` passed into `PageHeader` from `app/TripStory.tsx` widen the chip
cluster enough that the row never fits on one line) while pages without a day
counter — `/map`, `/gallery`, `/costs` — stay one row. That was deliberate and
is not what's being reported here.

What B170 didn't measure is that the chip cluster's width also depends on
which trip is active, independent of the day counter: `TripSwitcher`'s button
label is the active trip's own (localized) title, shown up to
`sm:max-w-[14rem]` (`components/TripSwitcher.tsx:76,88`). A trip with a longer
title makes the chip cluster wider than a trip with a short one, which shifts
the point in `PageHeader.tsx`'s flex-wrap row (`PageHeader.tsx:76`) where the
whole header stops fitting on one line. So two trip-story pages — same day
counter, same nav — can land on opposite sides of that wrap point at the same
viewport width, purely because their titles differ in length.

## Work

This is a judgment call, not a clear bug: B170 already accepted that the wrap
point moves with the chip cluster's width (that's the day-counter case), so
whether the *trip title's* contribution to that same width is also acceptable
is a design question, not a defect to route around blindly.

Options to weigh: give `TripSwitcher`'s label a fixed width so it doesn't vary
with the trip's title length (loses information — the label would truncate
more aggressively even when there's room); accept that the wrap point varies
per trip and treat this ticket as "no bug, closed unbuilt" once confirmed;
or decide the header's wrap decision should ignore `TripSwitcher`'s content
width entirely (e.g. give it a fixed basis like the title's `12rem`).

Not doing: redesigning the header wrap strategy — B170's one-row/two-row
approach and its `flex-[1_1_12rem]` title basis stay as they are.

## Acceptance

Either:
- at a fixed desktop width (1280 and 1440), every trip-story page wraps the
  same way (both one row, or both two rows) regardless of the active trip's
  title length, or
- this ticket is moved to `completed/` closed unbuilt, with the decision that
  per-trip variation in the wrap point is acceptable recorded at the top.
