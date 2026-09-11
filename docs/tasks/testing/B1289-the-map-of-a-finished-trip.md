---
id: B1289
title: The map of a finished trip is titled Where we're going and says no days are written when one is
type: ISSUE
priority: medium
complexity: low
area: map
found: "2026-09-10T10:56:23Z"
started: "2026-09-11T15:12:40Z"
merged: "2026-09-11T15:36:20Z"
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

**Built.**

- `app/[user]/(trip)/map/page.tsx`: both `generateMetadata` and the page now
  compute `getDays(ref, read)` alongside `getPlaces`, and the tense is
  `hasPlaces || (hasDays && isOver(trip, days))` rather than `hasPlaces`
  alone. `isOver` only gets a vote once a day actually exists — see the
  guard below, which is the whole subtlety in this ticket.
- **The zero-day case had to stay untouched, and nearly didn't.** The map
  page carries an existing, deliberate policy from B118: a trip with *no
  days at all* stays in the planned tense even once its dates are past —
  "has been nowhere and is going nowhere" — and `test/map-tense.test.tsx`
  already asserted this for a `status: past` trip with zero entries. My
  first pass tied the tense to `isOver(trip, days)` unconditionally, which
  flipped that case to the past tense too (a past-status trip with no
  entries is `isOver` by definition) and broke four tests. The fix is
  gating `isOver` on `hasDays` — the ticket's own case is a trip with *one*
  published day and no coordinates, not a trip with nothing written; those
  are different facts and needed different tenses.
- `app/[user]/(trip)/map/MapPageContent.tsx`: takes two new optional props,
  `over` and `hasDays` (both default `false`, the more conservative
  reading). `pastTense = hasPlaces || (over && hasDays)` drives the h1 and
  subtitle. The empty-map paragraph now reads `map.emptyNoPlace` ("no day
  says where it was") when `hasDays` is true and the older `map.empty` ("no
  days written") otherwise — `hasDays` is what tells the two apart, since a
  day with no coordinates never appears in `places` at all (B381).
- New locale key `map.emptyNoPlace` in en/de/hu, `npm run i18n:keys` run.
- **Not touched:** `components/WorldMap.tsx` derives its own aria-label
  tense independently, from `places.length > 0` only — it never sees `over`.
  This can only mismatch the h1 in a case this ticket doesn't name (a
  finished trip with a *planned route or track but no coordinate places*,
  which would now show a past-tense heading over a present-tense-labelled
  map region) and plumbing `over` into `WorldMap` felt like scope creep on a
  low-complexity ticket. Flagging it rather than fixing it quietly.

**Tests added**, both exercising the exact scenario the ticket names (a
finished trip, one published day, no coordinates) as well as re-confirming
B118's zero-day policy still holds:
- `test/map-tense.test.tsx`: `journal()` gained a `dayHasCoords` option; new
  test "a finished trip whose only day has no coordinates: the heading still
  looks back" (per locale).
- `test/map-page.test.tsx`: `render()` takes `over`/`hasDays`; new describe
  block asserts `map.emptyNoPlace` shows instead of `map.empty`, and that the
  heading looks back when `over` is true even with nothing to draw.

**Verified live in a browser** (local dev, `http://localhost:3411`) against
the demo journal's `alps-2024` trip (a real finished trip with real days,
already on disk) at 390px — renders "Where we've been" as before, no
regression. I did not have a local trip matching the exact no-coordinates
case to screenshot (the demo content's days all carry coordinates); that path
is covered by the two new automated tests above instead.

## Acceptance

- A finished trip's map page is not titled in the future tense.
- A trip with published days and no coordinates does not say no days are written.
