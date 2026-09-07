---
id: B570
title: MiniMap's SVG hydrates with a mismatch from floating-point rounding
type: ISSUE
priority: low
complexity: low
area: map, hydration
found: "2026-09-06T13:30:09Z"
started: "2026-09-07T10:37:36Z"
merged: "2026-09-07T10:56:40Z"
---

# B570 — MiniMap's SVG hydrates with a mismatch from floating-point rounding

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Found while verifying B569 in a browser, and unrelated to it: a trip's page logs
a React hydration mismatch from `MiniMap`'s SVG. The cause looks like
floating-point rounding — the server and the client format a projected
coordinate to different digits, so the `d` or `points` attribute differs by a
trailing decimal and React replaces the subtree.

It is a warning, not a visible fault, which is exactly why it has survived: the
map looks right. But a hydration mismatch means the server's markup is thrown
away and re-rendered on the client, and it fills the console — which is where
the *next* real fault is supposed to be visible. One shipped in the photobook
composer for that reason and was only noticed because a new control happened to
render an attribute React compares.

## Work

Round the projected coordinates to a fixed number of decimals in one place, so
both renders format identically. `toFixed` at the point of projection rather
than at each use, or the numbers will drift apart again the next time somebody
adds a shape.

Check whether anything else shares that projection — `lib/mapFrame.ts` and the
photobook's `projectEquirectangular` are neighbours, and a fix in the wrong one
would look right and change nothing.

## Acceptance

- Loading a trip's page logs no hydration warning.
- A test that would catch it, or a note in this ticket saying why one is not
  practical.

## Resolution

**Same bug as B500, found twice** — that ticket has the fix (`lib/mapFrame.ts`)
and the fuller writeup; this file has the part specific to what this ticket's
own investigation added.

`place()` and `frameRoute()` in `lib/mapFrame.ts` now round every number they
hand back to 4 decimal places, absorbing the ULP-level disagreement between
the server's and the browser's `Math.cos` before it reaches a `viewBox`, a
`cx`/`cy`, or a polyline point. `place()` is the single choke point its own
doc comment names — "the one place `lngScale` is applied to a point... Call
it rather than `project()` for anything drawn into a frame" — so every marker
in `MiniMap.tsx` and `WorldMap.tsx` goes through it, and one change covers
both components.

**`projectEquirectangular` in `lib/photobook/plan.ts` is not this bug and
needs no change.** It projects coordinates for a printed photobook page,
rendered server-side once into a static PDF — there is no client hydration
step to disagree with itself. `d`/`points` mismatches described above are
`MiniMap`'s SVG specifically (`components/MiniMap.tsx`), which draws through
`lib/mapFrame.ts`, not through the photobook's own projection.

Test: `test/map-frame.test.ts`, "B500 / B570 — rounding absorbs cross-runtime
float noise" — asserts the rounding, that a difference many orders of
magnitude larger than any real `Math.cos` gap still rounds identically, and
that repeat calls with the same input produce the identical string (the
actual thing React's hydration check compares). Reproducing two disagreeing
JS engines in one test process is not practical, so the acceptance's console
check on a live trip page is for a person with a browser.

`npm run verify` passes with the change in place.
