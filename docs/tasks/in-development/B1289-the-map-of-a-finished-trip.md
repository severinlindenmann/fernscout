---
id: B1289
title: The map of a finished trip is titled Where we're going and says no days are written when one is
type: ISSUE
priority: medium
complexity: low
area: map
found: "2026-09-10T10:56:23Z"
started: "2026-09-11T15:12:40Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T15:12:40Z"
---

# B1289 — The map of a finished trip is titled Where we're going and says no days are written when one is

## Why

`/test-mobile/map`, for a trip with `status: past`, `end: 2026-09-08`, on
2026-09-10, with one published day carrying three photographs:

> # Where we're going
> The route we mean to take, and the places we mean to sleep.
>
> Nothing to draw yet — **no days written**, and no route planned.

Two statements, both wrong, on one screen.

**The tense.** The trip is over — its own page says "The trip is over" three
lines into the hero, from the same `end` date. The map page is using the
upcoming-trip framing for a finished one, so it promises a route "we mean to
take" for a weekend that happened last week.

**"No days written."** One day is written and on the site. What is missing is
*coordinates* — the day carries `unrecorded: [costs, coordinates]` — which is a
different fact and the one the sentence should be reporting. As written it tells
the owner their day is not there.

The rest of the page is right to be empty; there genuinely is nothing to draw.
This is about the words around the emptiness, which are the only content the page
has at this width.

## Work

- Pick the heading and the subtitle from the same tense the trip hero uses.
  `lib/tripTime.ts` already answers whether a trip is over.
- Report what is actually missing. "No days written" and "no day says where it
  was" are different sentences and the second is the one that is true here; a
  day with no coordinates is the ordinary case for anybody writing without GPS.
- Check the same page for a trip that is under way, one that is upcoming, and one
  that is over — all three tenses exist and only one is being written for.

## Acceptance

- A finished trip's map page is not titled in the future tense.
- A trip with published days and no coordinates does not say no days are written.
