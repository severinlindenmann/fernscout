---
id: B1426
title: The preview's isTest banner has the same missing-context gap DraftNotice had
type: ISSUE
priority: low
complexity: low
area: components/StoryPager.tsx, components/HelperRoom.tsx
found: "2026-09-11T07:44:30Z"
---

# B1426 — The preview's isTest banner has the same missing-context gap DraftNotice had

## Why

Found while fixing B1257 (DraftNotice's `canPublish` falling back to
`false` with no `TripProvider` in scope). `DayCard` in
`components/StoryPager.tsx` computes `isTest` from `trip?.trip.test ===
true || day.entries.some((e) => e.test)`. The helper room's preview pane
(`PreviewPane` in `components/HelperRoom.tsx`) renders `DayCard` with no
`TripProvider`, so `trip` is always `null` there — the trip half of that
check can never be true in the preview, even when the real trip the day
belongs to is itself marked `test: true`. Unlike B1257, this is not (yet)
known to say anything false — the banner simply never shows in preview
for a trip-level test flag, rather than showing the wrong thing — but it
is the same shape of gap.

## Work

Decide whether the preview route's own answer already carries (or could
cheaply carry) the trip's `test` flag, and thread it into `DayCard` the
same way B1257 threaded `canPublish` — a prop that beats a `null`
context — rather than constructing a real `TripProvider` for one pane.

## Acceptance

A trip marked `test: true`, previewed in the helper room, shows the same
test banner a public reader of that trip would see.
