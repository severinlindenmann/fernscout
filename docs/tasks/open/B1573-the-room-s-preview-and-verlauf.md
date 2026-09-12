---
id: B1573
title: The room's preview and Verlauf > Tage only ever show the newest trip
type: FEATURE
priority: medium
complexity: medium
area: agent room
found: "2026-09-12T08:54:28Z"
---

# B1573 — The room's preview and Verlauf > Tage only ever show the newest trip

## Why

Reported directly, in two parts that turn out to share one root cause.

**B1.** The "Dateien" tab's trip photos group and the Preview tab both only
ever offer photographs from one trip — whichever is chronologically newest
by start date. `lib/helper/server.ts:410-422` (`filesForRoom`):

```
const newest = [...getTrips(username)].sort((a, b) => b.start.localeCompare(a.start))[0];
const trip: RoomFile[] = newest
  ? getAllMedia(newest.ref, AS_AUTHOR).slice(0, TRIP_TILES)...
  : [];
```

A journal with several trips gets exactly one of them offered as attachable
photos, always — including while writing about a different, older trip. The
person's example: seeing only "Algarve 2026" when the journal has more than
one trip.

**C.** The same shape, in the history panel's "Tage" tab.
`app/api/helper/[user]/sessions/route.ts:33-44` computes `newest` the same
way and returns only that trip's days:

```
// `days` is the newest trip's days for the panel's Tage tab (D44) — the
// same trip the files pane already scopes to, read the same way.
const newest = [...getTrips(user)].sort((a, b) => b.start.localeCompare(a.start))[0];
```

The comment confirms this was a deliberate, shared design decision (D44), not
an oversight in one place — both routes cross-reference "the same trip the
files pane already scopes to." That is exactly why one ticket covers both:
fixing the trip-selection logic in one place without the other would leave
the two panels disagreeing about which trip a person is even looking at.

**B2.** Separately, both routes are eager: `filesForRoom` runs at page-load
time in `app/agent/page.tsx` and calls `getAllMedia` (up to `TRIP_TILES = 60`
photographs) for that one trip on every load, whether or not the files pane
is ever opened; the sessions route reads every entry of that trip's days on
every open of the history panel. A journal with several trips, each with many
days, pays the cost of loading one trip's worth of data nobody asked for
instead of showing what trips exist and loading one only once chosen.

Person's own words, and the decision on how far to take this now: **build the
full fix** — a trip picker in both places, with each trip's photos/days
loaded only once opened, not preloaded for all trips.

## Work

- `lib/helper/server.ts` — `filesForRoom` currently returns `{ inbox, trip,
  tripTitle }` for one trip. Change the shape so the room can list every trip
  (id + title, cheap: `getTrips(username)` already returns this) without
  fetching any trip's media, and add a second, separately-callable read (a
  new route, e.g. `GET /api/helper/<user>/trip-files?trip=<id>`) that returns
  one named trip's photos on demand — same `getAllMedia` + `TRIP_TILES` cap
  logic, just parameterised on trip id instead of hardcoded to `newest`.
- `app/api/helper/[user]/sessions/route.ts` — same split: list every trip
  cheaply, and add a `trip` query parameter so the days list for one
  specific trip is fetched only when asked, rather than always computing
  `newest`'s days on every history-panel open.
- `components/HelperRoom.tsx` — both the files pane's trip-photos `Group`
  (currently `files.tripTitle`, around line 2498) and the history panel's
  "Tage" tab (`tripDays`/`tripTitle` state, `HelperRoom.tsx:1814-1815`) need a
  trip picker: list every trip, nothing preloaded, and fetch the chosen
  trip's photos/days only on selection — mirroring how the files pane already
  treats the inbox as the thing shown by default, per the person's own
  framing ("focus on the inbox more").
- Keep the inbox behaviour exactly as it is — nothing here is about the
  inbox, which already loads eagerly and correctly (it is what a person is
  most likely mid-task on).

## Acceptance

- On a journal with two or more trips, open the files pane on `/agent`: no
  trip's photographs are fetched until a trip is explicitly chosen from a
  list of all trips, and the inbox is what shows without any extra tap.
- Open the history panel's "Tage" tab on the same journal: the same trip
  list appears, and a trip's days load only once selected.
- Writing about an older trip and opening the files pane offers a way to
  reach that trip's photographs, not only the newest one.
- `npm run verify` passes, and `keep-the-contract` is run if the sessions or
  files routes changed shape (a new `trip` parameter is a schema change).
