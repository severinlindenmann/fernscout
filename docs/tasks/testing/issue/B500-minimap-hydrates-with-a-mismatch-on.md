---
id: B500
title: MiniMap hydrates with a mismatch on the last decimal place of every coordinate
type: ISSUE
priority: low
complexity: low
area: map, hydration
found: "2026-09-05T16:37:36Z"
started: "2026-09-07T10:37:36Z"
merged: "2026-09-07T10:56:38Z"
---

# B500 — MiniMap hydrates with a mismatch on the last decimal place of every coordinate

## Why

Every trip story page logs a React hydration mismatch, and the whole of it is
the last digit of floating-point numbers:

```
+ viewBox="119.27770020074101 118.64813878182102 64.65795589817283 ..."
- viewBox="119.27770020074107 118.64813878182102 64.65795589817283 ..."
+ cx={159.5836591369678}
- cx="159.58365913696784"
```

`components/MiniMap.tsx`. The server and the client compute the same
projection and disagree in the sixteenth significant figure, and React
compares the attribute strings. Note the second pair: server-rendered
attributes arrive as strings and the client sets numbers, so even a value
that agrees can be compared as `159.5836591369678` against
`"159.58365913696784"`.

It is cosmetic today — React says "this won't be patched up" and the map draws
correctly either way — but it is noise on the console of every story page,
which is where a real hydration bug would have to be noticed. Found while
looking at something else on `/example/trips/parks-2025`; it predates B11 and
B498 and has nothing to do with either.

## Work

Round the projected coordinates before they reach the markup — a fixed number
of decimal places, chosen once where the projection is computed rather than at
each of the dozen places that interpolate one. Sub-pixel precision on a map
that is a few hundred pixels wide is not doing any work.

Check whether the string-versus-number half needs anything separate once the
rounding is in: if both sides round to the same short decimal, the string and
the number should agree.

## Acceptance

- Loading `/example/trips/parks-2025` and `/example/trips/asia-2023` logs no
  hydration warning.
- The map still draws in the same place — compare a screenshot before and
  after, since rounding is exactly the kind of change that silently shifts a
  route by a pixel.

## Resolution

Fixed once, in `lib/mapFrame.ts` — the same bug as B570, found twice, closed
together. See B570's file for the full account; the short version:

`place()` (the one place `lngScale` is applied to a projected point — every
marker and polyline vertex in `MiniMap.tsx` and `WorldMap.tsx` goes through
it) and `frameRoute()` (which builds the `Frame` that becomes the SVG's
`viewBox`) both now round every number they return to 4 decimal places —
about 4 metres at this projection's scale, thousands of times finer than a
pixel on any map this draws. `Math.cos`, used to compute `lngScale`, is not
required by spec to return a correctly-rounded result, so the server's V8 and
the browser's can disagree by a handful of ULPs on the exact same call; that
noise was propagating into the viewBox and every coordinate, showing up as a
differing sixteenth significant figure that React's hydration check does not
forgive.

The string-versus-number half needed nothing separate: once both renders
compute the identical rounded `Number`, `String()` of that number is
identical too, on both sides.

Added `test/map-frame.test.ts` — "B500 / B570 — rounding absorbs cross-runtime
float noise" — which asserts every number `frameRoute` and `place` hand back
is rounded to the fixed precision, that a difference far larger than any
realistic `Math.cos` ULP gap still rounds identically, and that the same
input produces the identical string on repeat calls (the actual thing React
compares on hydration). A live two-engine reproduction is not practical in
this suite; the acceptance's screenshot comparison and a console check on
`/example/trips/parks-2025` and `/asia-2023` are for a person with a browser.

`npm run verify` passes with the change in place.
