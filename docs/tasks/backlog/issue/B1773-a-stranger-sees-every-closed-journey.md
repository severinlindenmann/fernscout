---
id: B1773
title: A stranger sees every closed journey at once on a journal with thirty trips
type: ISSUE
priority: low
complexity: low
area: Trips index
found: "2026-09-15T06:24:34Z"
---

# B1773 — A stranger sees every closed journey at once on a journal with thirty trips

## Why

B1766 capped the owner's lists — the trip cards, "what you can read", the
storage legend, the switcher. The one list it did not touch is `LockedTrips`
on `/<user>/trips`, which is what a signed-out stranger actually gets: on
fernscout.ch/severin that is thirty "Closed journeys" cards and nothing else,
measured signed out on 2026-09-15. The page a stranger lands on is the longest
version of it.

## Work

Same shape as B1766: show the first few locked cards and a `common.showMore`
button for the rest. `components` already has the pattern in three places.

## Acceptance

- A signed-out reader of a thirty-trip journal gets a short list and one press
  for the rest.
- Nothing about what is listed changes — this is presentation only, and B117's
  refusal to name a closed trip stays exactly as it is.
