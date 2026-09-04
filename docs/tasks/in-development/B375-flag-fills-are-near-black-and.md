---
id: B375
title: Flag fills are near-black and six European blues are indistinguishable, because the collision test compares hex rather than perceived colour
type: ISSUE
priority: medium
complexity: low
area: maps, trips
found: "2026-09-04T21:50:00Z"
started: "2026-09-04T21:20:17Z"
session: e8e2ddef-3ce3-473a-9308-388259ef4452
claimed: "2026-09-04T21:20:17Z"
---

# B375 — Flag fills are near-black and six European blues are indistinguishable, because the collision test compares hex rather than perceived colour

## Why

Found on the local demo (23 countries) immediately after B370 shipped, and
agreed with the owner.

**The collision check does not check what it claims to.**
`assignFlagColours` (`lib/flagColours.ts`) rejects a colour only when the exact
string is already taken, and B370's own test asserts
`new Set(got.values()).size === 5` — string identity. It passed, and the map
still failed: France `#0055A4`, Czechia `#11457E`, Estonia `#0072CE`, Finland
`#003580`, Sweden `#006AA7` and the United States `#3C3B6E` are six different
strings and one colour to the eye, sitting side by side across Europe. A test
that compares hex will keep passing however bad the map gets.

**Germany renders black** (`#111111`). `FLAG_COLOURS`' docblock bans white
because "a white country is a hole in the map" — and then walks into the mirror
image. Black reads as a void or a rendering fault, not as a place somebody has
been.

**And every fill is too dark and too saturated for the map it sits on.** Deep
navy and dark red on pale-green land reads as scattered ink rather than
countries; B361's single hue was duller but calmer, and this traded the calm
without buying legibility.

## Work

The fix the owner agreed to: **keep the flag's hue, normalise its lightness and
saturation into one band.** Italy stays green and Japan stays red, but every
fill sits in the same tonal range, so the map is cohesive and small countries
still read.

- Convert each flag colour to HSL, keep the hue, and clamp saturation and
  lightness to a band chosen against the pale-green land and blue sea. Hue is
  then the only channel carrying identity, which is what makes the rest of this
  tractable.
- **Reject achromatic candidates outright** — anything too dark, too pale or
  too grey has no usable hue, so black, white and grey flags must fall through
  to their alternate. That covers Germany, and Japan, Poland and Finland whose
  white is already handled by the table.
- **Compare hue distance, not strings.** A candidate collides when its hue is
  within some minimum arc of one already taken; the alternate is tried next,
  and where both collide, rotate the hue by the smallest amount that clears the
  gap rather than shipping a duplicate. Circular arithmetic — 350° and 10° are
  20° apart, not 340°.
- **Replace the test that gave false confidence.** Asserting `Set.size` over
  hex strings is what let this ship; assert a minimum perceptual separation
  instead, over the real European set that failed.
- Keep it deterministic: same journal, same colours, every render.

Not in scope: the legend, which is fine and stays as it is; the flag table's
own colours; the pin fallback.

## Acceptance

- No fill is near-black, near-white or grey.
- France, Czechia, Estonia, Finland, Sweden and the United States are
  distinguishable from each other on the map, asserted by hue distance rather
  than by string inequality.
- Italy is still recognisably green, Japan red, Thailand blue.
- The same journal renders the same colours twice.
- `npm run verify`.
