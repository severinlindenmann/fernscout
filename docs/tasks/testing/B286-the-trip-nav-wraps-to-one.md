---
id: B286
title: The trip nav wraps to one row on one trip and two rows on another at the same width
type: ISSUE
priority: low
complexity: medium
area: header, nav, ui
found: "2026-09-04T12:50:19Z"
started: "2026-09-04T12:59:49Z"
merged: "2026-09-04T13:13:43Z"
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

## Decision

Asked the person: fix it. `components/TripSwitcher.tsx:76` — the button's
`sm:max-w-[14rem]` (content-driven, so its rendered width tracked the active
trip's title length) becomes `sm:w-[14rem]` (fixed), with `sm:justify-between`
added so the chevron still sits at the box's right edge rather than drifting
in next to a short label. Icon and label are grouped in their own inner span
so `justify-between` only ever separates that group from the chevron. Same
mechanism B170 used for the title: a real, constant contribution to the
header row's fit calculation instead of a content-dependent one.

## One thing the measurement corrected

`/example/trips/japan-2027` — one of the two pages in the original report —
turned out to be an **upcoming** trip with no days written yet, so it takes
the early-return branch in `app/TripStory.tsx:364-370` and never mounts the
day-counter `children` at all. Its chip cluster was already narrower than
`parks-2025`'s (a past trip with entries) for that reason alone, before
`TripSwitcher`'s width is even considered — and that particular difference
**is** B170's already-accepted design (day counter present vs. absent), not
this ticket's.

So this fix does not make `japan-2027` and `parks-2025` wrap identically —
they still won't, because one has a day counter and the other doesn't, and
that's correct per B170. What it does fix is confirmed on a same-shape pair:
`alps-2024` ("Four days round the Alps") and `asia-2023` ("Five months
east") are both past trips with entries, so both mount the day counter.
Before this change their `TripSwitcher` chips measured 26 and 17 characters
of different rendered width, which is exactly the kind of pair the original
report was pointing at even though the two URLs it named happened to differ
in a second way too.

## Evidence

- `npm run build && npx tsc --noEmit && npx eslint . && npx vitest run` — all
  green (156 files, 2386 passed, 3 skipped unrelated Postgres tests; same 4
  pre-existing unrelated lint warnings as B285).
- `test/trip-switcher.test.tsx` — new. Renders the chip with a short trip
  title and a long one and asserts the class list carries `sm:w-[14rem]` and
  not `sm:max-w-[14rem]` in both cases — jsdom cannot assert the resulting
  layout, so this holds the one class list whose reversal brings the
  content-driven width back.
- Real browser (`next start`, Chromium), sweeping 1280 and 1360px:
  - Before: `japan-2027` chip 182px / not wrapped; `parks-2025` chip 224px /
    wrapped, at both widths.
  - After: `TripSwitcher` chip measures 224px on every trip regardless of
    title. `alps-2024` and `asia-2023` (both past, both with a day counter)
    now wrap identically at 1360px (`wrapped: true` for both) — before this
    change they were the pair actually at risk of disagreeing purely over
    title length, and now don't.
  - `japan-2027` (no day counter) and `parks-2025` (day counter) still wrap
    differently at these widths, which is B170's design, not a regression —
    confirmed the day-counter block is the entire difference between their
    chip clusters once `TripSwitcher` is fixed-width on both.

Merged via `b286-nav-wrap-variance`.
