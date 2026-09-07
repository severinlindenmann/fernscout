---
id: B650
title: A day's location: and its lat/lng can name towns 200 km apart and nothing says so
type: ISSUE
priority: medium
complexity: low
area: helper: icloud-export
found: "2026-09-06T19:33:10Z"
started: "2026-09-07T12:46:02Z"
completed: "2026-09-07T13:19:11Z"
---

# B650 — A day's location: and its lat/lng can name towns 200 km apart and nothing says so

## Why

`.claude/skills/icloud-export/build.mjs:71-73` picks `location` as the most
common place across the day. Lines 99 and 106 take `lat`/`lng` from the *first*
photograph that has them.

On the Saturday of `elsass-2025` these disagreed: `location: "Speyer"` with the
coordinates of Merzhausen, 200 km apart. The map pin and the label named
different towns and nothing complained — a person caught it after publication.

`validate-content` cannot catch this: it has no notion of where a name is.
`build.mjs` can, because it holds both — the place string of the `withGps`
photograph and the chosen `location` are in the same scope.

## Work

Compare the two in `build.mjs` and print one line on stdout when they differ. Do
not change either value and do not fail the build: a day that moves 200 km is a
normal day, and only the person can say which of the two is right. One printed
line is the whole fix.

## Acceptance

Building a day whose `location:` and `withGps` photograph name different places
prints a line naming both. A day where they agree prints nothing.

## Done
One warning line in `build.mjs`, printed when a day's `location:` (the most
common place across its photos) differs from the place named by the photo its
`lat`/`lng` actually came from. Neither value is changed and nothing fails —
the point is that the disagreement stops being silent. Covered by
`build.metadata.test.mjs`: a mismatch prints a line naming both towns,
agreement prints nothing.
