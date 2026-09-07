---
id: B708
title: A day of videos hits the per-day item limit early
type: ISSUE
priority: low
complexity: low
area: api, media
found: "2026-09-07T11:17:10Z"
started: "2026-09-07T11:40:34Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T11:40:34Z"
---

# B708 — A day of videos hits the per-day item limit early

## Why

`lib/api/media.ts:212` counts what is already in a day with
`fs.readdirSync(mediaOut).length` and measures it against `itemsPerDay`. That
directory holds *derivatives*, not items: a video leaves a poster frame beside
it, and a second format leaves another file. So a day of clips reaches the
per-day ceiling well before it has that many things in it, and the person is
told they have too many photographs when they have not.

Found while building B682.

## Work

Count items rather than files — the gallery in the day's own frontmatter is the
list that means something. Check `lib/photos.ts` for what already knows how to
enumerate them.

## Acceptance

A day holding ten videos counts as ten items, not thirty, and the limit refuses
at the right number. A test with a video fixture asserts it.
