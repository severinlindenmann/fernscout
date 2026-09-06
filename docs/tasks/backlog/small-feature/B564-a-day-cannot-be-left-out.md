---
id: B564
title: A day cannot be left out of the book
type: FEATURE
priority: high
complexity: medium
area: photobook, composer
found: "2026-09-06T10:56:07Z"
---

# B564 — A day cannot be left out of the book

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Every day of the trip is in the book and there is no way to say otherwise. A day
can have its layout changed, its photographs chosen and reordered, and its text
run on — but not be left out.

Not every day belongs in a printed book. A travel day with one blurry
photograph, a day that repeats the one before it, a day that is private. The
owner is the editor here and this is the most basic editorial act there is,
and it is the only one missing.

`excludePhotos` already exists, so a photograph can be dropped but the day it
belongs to cannot.

## Work

A per-day switch, in the day's own controls beside its layout, using the same
`options.days` record keyed by date that everything else per-day uses.

An excluded day leaves the book entirely — its day page, its photographs, its
place in the chapter — and the page count and price follow. Check what a chapter
does when every day in it is dropped, and what the route map does with a day
whose stop is gone: the map draws where the trip went, and a day left out of the
book is not a place the trip did not go. **Leave the route alone** unless
somebody argues otherwise in the ticket.

Excluding a day must be visible and reversible from level 1 — a day dropped from
inside its own drill-in, which then has nothing to show, is a trap. Say how many
days are in the book and offer the way back.

## Acceptance

- A day can be left out and put back, and the page count and price both follow.
- The route map still shows the trip that happened.
- A chapter with no remaining days does not print an empty chapter divider.
