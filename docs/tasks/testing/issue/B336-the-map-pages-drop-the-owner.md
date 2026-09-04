---
id: B336
title: The map pages drop the owner's draft days while the same page's planned route keeps them
type: ISSUE
priority: medium
complexity: low
area: maps, entries, drafts
found: "2026-09-04T19:18:30Z"
started: "2026-09-04T19:26:10Z"
merged: "2026-09-04T19:44:04Z"
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

## Resolution

**Decided rule: the solid markers follow `draftsVisibleTo(trip)` — the same
audience `getPlan` and the journal home page already use.** Not the other
reading (home page is the odd one out). Two of the three existing call sites
had *already* widened past "owner only" for this exact reason (B327): `getPlan`
says so in its own comment ("somebody on the trip is not that reader"), and the
home page's `buildStoryProps(tripId, { includeDrafts: drafts.visible })` has
been doing this since B327 landed. The bare `getPlaces` calls were the outlier,
not the rule. Narrowing everything back to published-only instead would have
undone B327 in three more places — the exact bug that ticket was written to
stop recurring — so it was rejected.

**Applied to every `getPlaces` caller named in Work, plus the `getTripStats`
call sitting next to each one** (not in the original list, but computing the
same trip's day/place/country counts from a different audience than the
markers beside them on the same page reintroduces this ticket's own bug one
line over — `stats.places` disagreeing with `places.length` on the page we
were fixing):

- `app/[user]/(trip)/map/page.tsx` — `getTripStats`/`getPlaces` now share one
  `{ includeDrafts: drafts.visible }`; `generateMetadata`'s `visited` (line 49)
  now resolves the trip and asks `draftsVisibleTo` too, so the tab title and
  the page it labels can no longer disagree.
- `app/[user]/trips/[trip]/map/page.tsx` — the same shape, trip-scoped.
- `app/[user]/trips/page.tsx` (lifetime map) — one trip's drafts are not
  another's (B327's "per trip, never per journal"), so each `travelled` trip's
  `draftsVisibleTo` is resolved individually (`Promise.all`) before
  `getPlaces`/`getTripStats` are called per trip.

**The banner**: `MapPageContent` gained `hasDraftPlaces` (some place's
`entries` include a draft), rendered as a caption next to the stats block —
same shape and audience-aware wording (`canPublish`) as the existing
`hasDraftStops` caption for the planned route, not a second loud notice. Two
new keys, `map.stopsFromDrafts` / `map.stopsFromDraftsShared`, added to
en/de/hu and regenerated into `lib/i18n.ts` via `npm run i18n:keys`.

**Test**: `test/map-draft-places.test.ts` — one `status: past` trip (so it is
both the fallback "current" trip for `/<user>/map` and reachable directly at
`/<user>/trips/<id>/map` without the current-trip redirect) with a published
day and a draft day in different locations. Confirmed red on the pre-fix code
(`git stash` of the three page files) — all three owner-session assertions
failed at 1 marker instead of 2 — then green after. A signed-out reader gets 1
on all three, unchanged.

**Collateral**: `test/draft-audience.test.ts`'s blunt `isOwner`-beside-`draft`
grep now also matches `app/[user]/trips/page.tsx`, which legitimately calls
both — `isOwner` there decides whether to show malformed-trip debug info
(unrelated to drafts), while the draft question goes through
`draftsVisibleTo` like everywhere else. Added to that test's `OWNER_ONLY`
exemption set, with the reason written next to the existing one.
`test/map-tense.test.tsx`'s cookie-jar mock returned its locale-test cookie for
*any* cookie name, including `fs_session`; once `generateMetadata` started
reading that cookie (via `draftsVisibleTo`), the mock handed it a bogus
session token and the test failed on a missing database. Fixed to key on the
cookie name, matching how every other mock in the suite already behaves.

No second, unrelated problem was found while doing this — everything touched
was inside the inconsistency the ticket describes.

`npm run verify` passes (build, tsc, eslint — pre-existing warnings only,
vitest 2632 passed / 3 skipped for Postgres).
