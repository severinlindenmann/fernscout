---
id: B989
title: The trip hero offers four equally loud actions and three of them go to the same place
type: FEATURE
priority: medium
complexity: low
area: Trip hero
found: "2026-09-08T16:44:44Z"
started: "2026-09-08T16:45:11Z"
merged: "2026-09-08T16:58:12Z"
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
- The photobook link becomes a quiet link too. It was to keep its capsule,
  but a lone capsule among three text links reads as a mistake rather than as
  emphasis — and on a finished trip the filled button is already there.
- A first-time reader has no resume button at all (`canResume` in
  `app/TripStory.tsx`), which would have left the card with no filled button
  and nothing but links. So the latest-day jump takes the primary in that
  case: there is always exactly one filled button, never two.

Not doing: the live-location chip, the new-days banner, or anything about what
the buttons *do*. Nothing is removed — only its weight changes.

## Acceptance

- The trip hero renders exactly one filled button — resume for a returning
  reader, the latest-day jump for a first-time one — plus text links, seen at
  390px and at desktop width.
- The bell has an accessible name (the existing push label) and remains a
  44px target.
- `PushOptIn` still renders nothing where the browser cannot do push.
- `npm run verify` passes.
