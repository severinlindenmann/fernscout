# W32 — A trip that is over

## Why

The hero says "Right now we're in 🇺🇸 Cannon Beach". After the trip ends that
is a claim about the world that is no longer true. A past trip already says
"The last stop was", but a *current* trip whose last day has passed still
says "right now" until somebody edits the frontmatter.

## What it does

1. A trip whose `end:` is in the past, or whose last entry is flagged, is
   **over** regardless of its declared `status`.
2. The final day carries a marker — `lastDay: true` in frontmatter, or simply
   being the last entry of a finished trip.
3. The hero then reads **"The trip is over"** with the finishing place and
   date, and the live pulsing dot goes.
4. The day itself gets a quiet end-of-trip note, so a reader who arrives at
   the last day knows there is no more rather than pressing Continue.

## Work

1. `lib/tripTime.ts` — `isOver(trip, days)`, one place, tested against
   timezone edges as the rest of that file is.
2. `TripHero` uses it: `live` becomes `isOver ? false : status === "current"`.
3. A `trip.over` / `trip.ended` string in all three languages.
4. The pager's last step shows the end marker.

## Acceptance

- A current trip past its end date stops claiming a location.
- A trip still running is unchanged.
- The last day is marked, and the marker is not on any other day.
