---
id: B1416
title: The files-rail chip downloads uncapped photographs for a 42px avatar
type: ISSUE
priority: medium
complexity: low
area: components/HelperRoom.tsx
found: "2026-09-11T07:09:18Z"
started: "2026-09-13T07:11:19Z"
merged: "2026-09-13T07:14:42Z"
---

# B1416 — The files-rail chip downloads uncapped photographs for a 42px avatar

## Why

Found while fixing B1298 (the day chip, same bug). `HelperRoom.tsx:2368`
draws a 42px avatar with `fill` and `sizes="42px"`; next/image's candidate
widths for `fill` plus a fixed `sizes` string are not narrowed the way a
`vw` value is, and `mediaLoader` (`components/mediaLoader.ts`) forwards
whatever width it is asked, floored only to `MEDIA_WIDTHS`' 320px minimum —
never lower. So this control can request the same oversized derivatives
B1298 measured (up to 117KB for a thumbnail that renders at 42px), on
every row of the files rail.

## Work

Same fix as B1298: drop `fill`, pass `width={42} height={42}` instead so
next/image's 1x/2x/3x candidates all floor to `MEDIA_WIDTHS`' 320px
minimum. `MEDIA_WIDTHS` in `lib/mediaSizes.ts` is not to be touched — no
new tier.

## Acceptance

Curl the requested derivative URL for a files-rail row's thumbnail and
confirm it asks for `?w=320`, not a larger candidate — this is a
network-bytes bug, not a rendering one, so verify by curl rather than
screenshot.

## Related

Same fix as B1417, and the same mistake B1298 already fixed once: a `fill`
layout with a fixed pixel `sizes` value does not narrow the candidate widths,
so the loader serves the 320px floor for a thumbnail. Do the two together, and
grep for any third instance while you are in there — the pattern has now
recurred twice after being fixed.

## Revalidated — 2026-09-13

Still valid: the files rail still uses `fill sizes="42px"`; the fix is isolated
to the image layout and has no product decision.

## Implemented / Verification

The 42px rail image now uses explicit dimensions. The paired inbox thumbnails
were corrected in the same change. Focused inbox/helper tests passed; build,
typecheck, lint, and knip pass with existing warnings only.
