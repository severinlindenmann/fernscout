---
id: B500
title: MiniMap hydrates with a mismatch on the last decimal place of every coordinate
type: ISSUE
priority: low
complexity: low
area: map, hydration
found: "2026-09-05T16:37:36Z"
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
