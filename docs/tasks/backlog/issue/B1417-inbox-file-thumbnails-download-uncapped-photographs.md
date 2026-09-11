---
id: B1417
title: Inbox file thumbnails download uncapped photographs for a 96px tile
type: ISSUE
priority: medium
complexity: low
area: components/InboxFileGroups.tsx
found: "2026-09-11T07:09:26Z"
---

# B1417 — Inbox file thumbnails download uncapped photographs for a 96px tile

## Why

Found while fixing B1298 (the day chip, same bug). `InboxFileGroups.tsx:139`
draws a 96px tile with `fill` and `sizes="96px"`; next/image's candidate
widths for `fill` plus a fixed `sizes` string are not narrowed the way a
`vw` value is, and `mediaLoader` (`components/mediaLoader.ts`) forwards
whatever width it is asked, floored only to `MEDIA_WIDTHS`' 320px minimum —
never lower. So every tile in an inbox grid can request the same
oversized derivatives B1298 measured for a thumbnail this size.

## Work

Same fix as B1298: drop `fill`, pass `width={96} height={96}` instead so
next/image's 1x/2x/3x candidates all floor to `MEDIA_WIDTHS`' 320px
minimum. `MEDIA_WIDTHS` in `lib/mediaSizes.ts` is not to be touched — no
new tier.

## Acceptance

Curl the requested derivative URL for an inbox tile and confirm it asks
for `?w=320`, not a larger candidate — this is a network-bytes bug, not a
rendering one, so verify by curl rather than screenshot.
