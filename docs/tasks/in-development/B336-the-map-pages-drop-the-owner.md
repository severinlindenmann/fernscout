---
id: B336
title: The map pages drop the owner's draft days while the same page's planned route keeps them
type: ISSUE
priority: medium
complexity: low
area: maps, entries, drafts
found: "2026-09-04T19:18:30Z"
started: "2026-09-04T19:26:10Z"
session: cae3e4fb-d628-4a89-89b7-43a581bc7e71
claimed: "2026-09-04T19:26:10Z"
---

# B336 — The map pages drop the owner's draft days while the same page's planned route keeps them

## Why

Found 2026-09-04 while answering why `fernscout.ch/viki` shows a different
number of points on each of its map surfaces.

`app/[user]/(trip)/map/page.tsx:82-84`, three adjacent lines:

```ts
const drafts = await draftsVisibleTo(trip);
const plan = getPlan(tripId, { includeDrafts: drafts.visible });
const places = getPlaces(tripId);                    // <- no options
```

`getPlan` is told who may see drafts. `getPlaces` is not, so `includeDrafts`
defaults to false and the solid "where we have been" markers exclude draft days
**for everybody, the owner included** — while the dashed planned route on the
same map includes them. One map, two answers to the same question, decided a
line apart.

The journal home page is the third answer: `app/[user]/(trip)/page.tsx:28`
passes `includeDrafts: drafts.visible` into `buildStoryProps`, so `MiniMap`
plots the draft days. An owner therefore sees their unpublished days on `/<user>`
and not on `/<user>/map`, with nothing on either page saying so.

`app/[user]/trips/page.tsx:153` has the same bare call — `getPlaces(t.ref)` —
so `LifetimeMap` on `/trips` drops them too.

This is not the coordinate problem (B265, B267). A day with coordinates that is
still a draft is plotted on one surface and silently absent from two others.

## Work

- Decide the intended rule first, because both readings are defensible: either
  the visited-places markers follow `draftsVisibleTo` the way `getPlan` and the
  home page already do, or the home page is the one that is wrong and drafts
  belong only on the dashed planned route. The current state is neither, and
  the *inconsistency* is the bug regardless of which way it resolves.
- Whichever it is, apply it at every `getPlaces` caller that feeds a map —
  `app/[user]/(trip)/map/page.tsx:49` and `:84`, `app/[user]/trips/page.tsx:153`,
  `app/[user]/trips/[trip]/map/page.tsx:62` — not just the one in evidence.
  Note `:49` uses `getPlaces(...).length > 0` to decide whether the page claims
  anything was visited at all, so it has to move with the rest or the heading
  and the markers disagree.
- If drafts do get plotted, the draft banner has to cover the map the way it
  covers the story, or a guest-facing screenshot of the owner's view becomes
  misleading. Check what `MapPageContent` already renders for `map.plannedFromDrafts`
  before adding a second notice.
- Not in scope: `getPlaces`' grouping of consecutive same-`location` days into
  one place (that is working as designed) and B265/B267.

## Acceptance

- A trip with a published day and a draft day, both carrying coordinates,
  plots the same set of markers on `/<user>`, `/<user>/map` and `/<user>/trips`
  for one viewer — whatever that set is agreed to be.
- A signed-out reader sees only published days on all three.
- A test that fails today: assert marker counts match across the three surfaces
  for an owner session on such a trip.
- `npm run verify`.
