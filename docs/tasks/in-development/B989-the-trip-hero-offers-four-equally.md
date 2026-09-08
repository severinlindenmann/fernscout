---
id: B989
title: The trip hero offers four equally loud actions and three of them go to the same place
type: FEATURE
priority: medium
complexity: low
area: Trip hero
found: "2026-09-08T16:44:44Z"
started: "2026-09-08T16:45:11Z"
session: d7d95eaa-ad82-4d84-b302-8b05c3955732
claimed: "2026-09-08T16:45:11Z"
---

# B989 — The trip hero offers four equally loud actions and three of them go to the same place

## Why

`components/TripHero.tsx:234-266` renders four pill-shaped buttons stacked
under the masthead: resume, latest day, read from the start, and — via
`PushOptIn` — notify me about new days. A fifth appears on a finished trip
with photographs (the photobook). They are the same shape and nearly the same
weight, so nothing tells a reader where to start, and three of them do the
same thing: enter the reading, at a different point.

A person looking at their own trip described the card as cluttered, which is
what four competing capsules look like. The information is right; the ranking
is missing.

## Work

Variant A of four sketched for the owner, and the one chosen:

- Resume stays as it is — the one dark, full-width primary.
- Latest day and "from the start" become quiet inline text links on one row
  beneath it, not filled capsules.
- `PushOptIn` becomes an icon-only bell at the end of that row, with an
  accessible name rather than a visible label.
- The photobook link keeps its own capsule; a finished trip has no resume
  button, so it is not competing with anything.

Not doing: the live-location chip, the new-days banner, or anything about what
the buttons *do*. Nothing is removed — only its weight changes.

## Acceptance

- The trip hero renders one filled button (resume) plus text links, seen at
  390px and at desktop width.
- The bell has an accessible name (the existing push label) and remains a
  44px target.
- `PushOptIn` still renders nothing where the browser cannot do push.
- `npm run verify` passes.
