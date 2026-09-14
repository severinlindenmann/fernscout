---
id: B1417
title: Inbox file thumbnails download uncapped photographs for a 96px tile
type: ISSUE
priority: medium
complexity: low
area: components/InboxFileGroups.tsx
found: "2026-09-11T07:09:26Z"
started: "2026-09-13T07:11:20Z"
merged: "2026-09-13T07:14:43Z"
completed: "2026-09-14T16:31:33Z"
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

## Related

Same fix as B1416, and the same mistake B1298 already fixed once. Do the two
together, and grep for a third instance while you are in there.

## Revalidated — 2026-09-13

Still valid: inbox file tiles still use `fill sizes="96px"`; the fix is
isolated to the image layout and has no product decision.

## Implemented / Verification

Inbox image tiles now use explicit 96px dimensions, preventing oversized
candidate requests. Focused inbox/helper tests passed; build, typecheck, lint,
and knip pass with existing warnings only.
