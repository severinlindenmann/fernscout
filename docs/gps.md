# Where somebody actually went

A trip's maps know a handful of points — one per day, one per photograph — and
join them with straight lines. A week of driving through the Alps renders as
four chords across the mountains. The shape of the travel, which is most of
what a reader recognises, was not in the content model at all.

This is how it gets there: the owner's own location history goes into a private
store, and one trip's worth of it is boiled down into a line the trip owns.

## Two files, and the seam between them is the point

```
content/<user>/
  gps/                          PRIVATE. Never served, never exported.
    YYYY-MM.jsonl               [epochSeconds, lat, lon], one fix per line
    exclude.json                places that are never drawn
  trips/<trip>/track.json       the derived line — the only thing rendered
```

The store is somebody's complete location history: every address they sleep
at, every place they work, everywhere they have been ill. So:

- **No route reads it, with one named exception.** There is no API that
  returns a position. `test/gps-store.test.ts` asserts nothing under `app/`
  imports `lib/gps/store.ts` or `lib/gps/enrich.ts` — and, separately, that
  `placeForDay` (below) is the only export in `lib/gps/api.ts` that reaches
  into the store at all.
- **It is in no export.** `appendUserContent` walks `trips/` and `config.json`
  and nothing else.
- **It is inside the storage ceiling for free** — `lib/storageQuota.ts` counts
  the whole of `content/<user>/`.
- It *is* in the owner's filesystem backup (`scripts/backup.sh`), because it is
  theirs.

`track.json` is the opposite: it belongs to the trip the way its photographs
do — in the trip folder, in the trip's export, behind the trip's own gate.
**Delete `content/<user>/gps/` entirely and every trip renders exactly as
before.** That is the reason for two files rather than one, and it is a test.

## Importing

**Over the API, and only over the API.** B665 shipped a CLI and B671 deleted
it: the owner of a hosted journal has no shell on the machine the site runs on,
and an agent never has one, so a capability whose only door was `npm run` was a
capability the two people it was built for could not use. Two doors would have
been worse — the unexercised one is the one that rots.

```http
GET  /api/v2/<user>/import          the kinds, and the formats each one knows
POST /api/v2/<user>/import          {"kind": "gps", "inbox": "<id>"}
```

The export is staged in the inbox first (`POST /api/v2/<user>/media` with
`intent.kind: "gps_history"` and `trip` declined — a `.json` or `.gpx` lands in
the inbox), then named by id. Multipart `file` is the one-shot; `text` takes a
few lines inline to the `/api/v2/<user>/import` call itself.

The format is detected from the file's own contents; `format` overrides.
`?dryRun=true` (a query parameter, not a body field) parses, runs the kind's
own contract check, reports what it found and writes nothing — which is how
somebody tests an importer they wrote.

The owner's own journal-wide token, or the narrow `write:gps` token (B2204,
below), for a real, non-dry-run `kind: "gps"` import only — every other kind,
and every dry run, is owner only. A trip-scoped token is refused outright:
the history covers every day of somebody's life, not the days its holder was
there.

**Thinning: a fix is kept if it is five minutes after the last kept one, or
250 metres from it.** Time alone logs a phone fidgeting on a bedside table all
night; distance alone is fine until a motorway, where five minutes is an
eight-kilometre chord and the road stops looking like a road. A real ten-month
Google export came out at 16,315 fixes and 508 kB.

Re-importing the same file changes nothing — the thinning is applied to the
merged set, and one second holds one position.

### Adding a format

`importers/gps/` is where a position format lives, and `importers/` is
**MIT-licensed**, unlike the rest of this repository. Add the file, then list
it in `GPS_IMPORTERS` (`importers/gps/index.ts`) — that one array is what
`GET /api/v2/<user>/import` reports and what detection walks.

`importers/gps/schema.ts` is the whole contract — the row type, and
`checkGpsImporter`, which checks an importer's output against it and names
what is wrong in words. There is no CLI: the `?dryRun=true` API call above is
how somebody tests an importer they wrote. The kind of data is the folder, so
a bank export into a trip's costs would be `importers/costs/` with its own
`schema.ts`, not a file beside `gpx.ts`. See `importers/README.md`.

If your tool is not TypeScript, do not write an importer — have it print JSON
Lines and use the `fixes` format that is already there.

## Deriving a trip's line

```http
POST /api/v2/<user>/trips/<trip>/track
```

Separate from the import because it is a separate decision — and one that can
be made years later, or never. It answers with counts and never with a
coordinate.

**B2202 was reworked after its own security review** found that clipping the
guarantee into derivation — and re-running it from publish/unpublish — left
too many other doors open: the helper unpublish route, a `PATCH` that moves a
published day's date, move/merge (`lib/studio/reshapeDay.ts`), the trip's
`visibility` levels, and a `track.json` written before any of this existed
all reached a reader without going through the hook that was supposed to be
the guarantee. The fix moves the guarantee to *serve time* instead: derivation
now covers the whole trip regardless of publish state, and every place that
draws the line filters it itself, from whatever it already knows about this
reader — the same way visibility, drafts and everything else on a trip page
already work.

Derivation (`deriveTrack` in `lib/gps/enrich.ts`, called through
`deriveTripTrack` in `lib/gps/api.ts`):

1. **Covers every trip date**, drafts included. There is no published-day
   filter here any more — a `POST …/track` (or an import) derives the whole
   trip, and what a particular reader is shown is decided afterwards, at
   serve time (below).
2. **One local-midnight window per date.** Each trip date gets a window from
   local midnight to local midnight, in that date's own day's `timezone`
   field when one was written, else UTC — a trip crossing zones no longer
   mis-assigns an evening fix to the wrong calendar date the way a single UTC
   split did. A run is broken at every window boundary, and the resulting
   segment is tagged `day: "YYYY-MM-DD"` (`TrackSegment.day`,
   `lib/gps/track.ts`) — the field the serve-time filter below keys on.
3. **Never inside the last 24 hours**, whatever a day's own date says. A day
   published minutes after it starts must not draw a live line to where the
   owner is right now; `deriveTripTrack` caps the clip at `now - 24h`.
4. **Private zones removed, and the line broken there** — not merely joined
   across by the gap rule. Clipping by date does not help on the morning of
   day one, which starts at the front door.
5. **Broken at gaps** longer than two hours. A flight is a hole in the data,
   and a hole is drawn as a break rather than a straight line across France.
6. **Both ends of every run are private for 500 m.** Every point within
   500 m straight-line (haversine) distance of a run's first or last point is
   dropped, and the run breaks there (`trimByDistance` in
   `lib/gps/enrich.ts`) — the ends are where somebody likely slept, so they
   act like short-lived private zones for the whole run, and a day that walks
   back past the hotel door at noon does not draw it either. Distance, not
   path length, because GPS jitter defeats path length: a phone wobbling
   ±15 m on a nightstand for three hours accrues hundreds of metres of path
   without moving at all.
7. **Simplified** (Douglas–Peucker, 50 m), so a ten-day trip is about 500
   points and 10 kB rather than forty thousand points.
8. **An empty result deletes any existing `track.json`** rather than leaving
   it stale — nothing left to draw from the store is treated as a safety gap,
   not a convenience to preserve.

**Serve time is where the guarantee actually lives now.** `readerTrack(user,
trip, visibleDates)` in `lib/gps/track.ts` keeps only the segments whose `day`
is in the set of dates this particular reader is currently shown an entry
for — the same date list the page already resolved (`getDays`, drafts and
visibility both applied). A segment with no `day` at all is a legacy file,
derived before this field existed, and is dropped rather than trusted: there
is no way to know which date it came from, so there is no way to know it is
safe. Both map pages
(`app/at/[user]/(trip)/map/page.tsx`, `app/at/[user]/trips/[trip]/map/page.tsx`)
and the export (`lib/exportZip.ts`, filtered to published dates in every
scope) go through `readerTrack`; nothing else under `app/`, `components/` or
`lib/` reads `track.json` raw except the owner-only `/track` route, which
only ever answers with counts.

**Re-derivation happens on import, not on publish or unpublish.** A
successful, non-dry-run GPS import (`importGps` in `lib/gps/api.ts` — the one
function every import route, v2 and helper, calls) re-derives every trip
whose date range overlaps the imported fixes, best-effort, and reports counts
and per-trip success in its response, never a coordinate. Publishing or
unpublishing a day no longer touches `track.json` at all: there is nothing
left in it that publish state alone controls, so there is nothing for those
routes to re-derive or prune. The explicit `POST …/track` route still works,
for re-deriving on demand.

**A track written before this rework has no `day` on its segments and is
invisible to every reader** until it is re-derived once — the safe default,
since an un-migrated file predates the field the serve-time filter depends
on. `npx tsx --conditions=react-server scripts/rederive-legacy-tracks.mts`
(add `--dry-run` to preview) finds every trip with both a `track.json` and an
owner with GPS history and re-derives it; a deploy that ships this rework
runs it once afterwards.

The owner's own studio *does* now draw the unclipped line — B2226 answered
B2202's "may" undecided. Everyone who reads a trip's own map, owner
included, still sees the same filtered, trimmed `readerTrack`; the owner's
"Your route" section (below) is a different view onto a different question:
not "what may a reader see" but "what did my phone actually record".

## The live tail — B2536

`track.json` never carries the last 24h, on purpose (`MIN_AGE_MS`). Some
readers may still be shown it — the owner always, a trip's own named guests
by default — and that line is derived and stored the same careful way
`track.json` is, in a **second file**:

```
content/<user>/trips/<trip>/track-recent.json
```

Same shape as `track.json` (`Track`, `lib/gps/track.ts`), same rules — the
trip's own private zones cut, 500 m straight-line trimmed off **both** ends
of every run, so the newest point is never the exact current position —
just the opposite time window: `[now - 24h, now]` instead of "older than
24h". `deriveTripTail` (`lib/gps/api.ts`) runs inside `deriveTripTrack`
itself, at exactly the same moments — an import, or the explicit
`POST …/track` — so the two files can never disagree about what "this trip"
means even though their time ranges never overlap. An empty result deletes
the file, same reasoning as `track.json`'s own "nothing left to draw".

**Who gets it is a serve-time decision, exactly like `track.json`'s own
date filter, and it is the *same* function that decides both.**
`readerTrack(user, trip, visibleDates, live)` (`lib/gps/track.ts`) takes one
more argument: `live`, resolved by the caller from `mayReadLiveTrack(trip)`
(`lib/tripGate.ts`) — never guessed at the call site. That function is keyed
on the trip's own `visibility` (the way D6 actually decided it), not on who
the reader is, past two exceptions:

- **The journal's real owner** (`owner.email`, never the instance operator —
  see below) — always live, on any trip, whatever its visibility or its own
  `guestsLive` says.
- **The instance operator (`FERNSCOUT_ADMIN_EMAIL`, B480) reading a journal
  that is not their own** — never live, checked before every visibility
  branch. B480 gives the operator every other owner-widening door on every
  journal (reading, publishing, contacts, credits); this is the one it must
  not, because what it protects is a person's real-time location rather
  than their content.
- **`public`** — never live for anyone but the owner. "At least 24h late" is
  unconditional on a public trip: a traveller reading their own trip gets
  the same delayed line a stranger does, because a public trip is the one
  case where "who is asking" is not a question this function still asks.
- **`guest`** — `trip.guestsLive` (`Trip`, `lib/types.ts`; `boolean`, absent
  reads as `true`) decides it, for whoever reaches the trip at all: a named
  guest of the journal or a traveller on this trip. Editable only in the
  owner's own studio (`/@<user>/studio/trip/visibility`, asked only on a
  `guest` trip — `private` has no readers to ask about and `public` is
  24h-late for everyone regardless), and readable back over
  `GET /api/v2/<user>/trips/<trip>` like `reminder` and every other plain
  trip setting — a v2 `PATCH` may write it too, gated the same owner-only
  way every other field on that document is.
- **`private`** — live for whoever may actually read it: the people who
  were there. There is no public or approved-guest reader of a `private`
  trip to ask this question about; `mayReadTrip` refuses them before this
  could ever be reached for them.

**The tail is also refused once it has gone stale**, independent of who is
asking: `readerTrack` only merges it in — and the map page's own "updated N
min ago" copy (`liveTailStatus`, same file) only reports a number — when the
file's own `generated` instant is itself under 24h old. Derivation only runs
when something imports or explicitly re-derives (`deriveTripTrack`), so a
trip nobody has touched in two days would otherwise go on answering "live"
with a tail that quietly aged out from under it; the freshness check is what
keeps that from happening, on top of, not instead of, the visibility rule
above.

**Three separate doors keep a bearer token off `track-recent.json`, named
here so the claim is checked rather than asserted:**

1. **No page a bearer token can reach ever asks for it live.** Every caller
   of `readerTrack`'s `live` branch is a page rendered behind a browser
   cookie — both map pages
   (`app/at/[user]/(trip)/map/page.tsx`, `app/at/[user]/trips/[trip]/map/page.tsx`).
   An agent token reaches `/api/…` and never a rendered page (AGENTS.md).
   The export (`lib/exportZip.ts`) and the story build (`lib/tripView.ts`)
   still call `readerTrack` with `live` left at its default `false`.
2. **It is excluded from the sync manifest.** `lib/sync/manifest.ts`'s
   `DERIVED_FILES` names it beside `track.json`, so `GET
   /api/v2/{user}/sync/manifest` (a `write:content` bearer door) never lists
   it and `GET /api/v2/{user}/sync/file` refuses to serve it even if asked
   for by its exact path — one predicate, `inSync`, decides both, so the two
   cannot drift apart.
3. **It is excluded from every export.** `lib/exportZip.ts` skips
   `track-recent.json` outright while walking a trip's own folder, in the
   whole-journal export (`/@<user>/export.zip`), the mailed delete archive,
   and the `open-to-link` scope alike — unlike `track.json`, which is
   filtered and re-shipped, the tail is never shipped at all: it is a file
   on somebody else's machine the moment it leaves, with no reader-facing
   gate left to filter it through afterwards.

### Private zones

`content/<user>/gps/exclude.json`:

```json
[{ "label": "home", "lat": 47.38564, "lon": 8.21819, "radiusM": 500 }]
```

**Deliberately not in the journal's `config.json`**, which goes into the
owner's own export. An anonymous visitor cannot download an export at all
since B1086 — `"open-to-link"`, the scope that once let one, is served by no
HTTP route and exists only as a library function used from the CLI and from
the deletion mail's own trip-scoped archive. A home address written into
`config.json` to keep it off the map would still leave with the owner's own
export, so the zone list stays a separate file for exactly the reason above:
it never leaves at all.

An unreadable list is refused rather than ignored: failing open here puts
somebody's front door on a public map.

**Written over the network since B2203** — a hosted owner has no shell on the
machine this runs on, and neither does an agent:

```http
GET  /api/v2/<user>/gps/zones
PUT  /api/v2/<user>/gps/zones
```

Owner only — a trip-scoped, guest, or narrower agent token (such as the
recorder's own `write:gps`, B2204) is refused; a zone is journal-wide, not one
trip's. `GET` answers with the zones exactly as the owner typed them, the
decline flag (below), and the limits a caller needs before hitting them
(`maxZones`, `radiusM.min`/`.max`). This is not the coordinate leak the rest
of this document warns about: a zone is what the owner *entered* — a label, a
place, a radius — never a position read out of the store. `PUT` replaces the
whole zone list; sending `homeDeclined` alone changes only that flag, and
leaving `zones` out is refused (`invalid_request`) rather than guessed as "no
change" — the same "every accepted field is readable back, nothing is
inferred" rule every v2 write follows.

The studio's own copy of this door, `/api/web/<user>/gps/zones`, answers the
owner's browser cookie instead of a bearer token — same domain functions
(`lib/gps/api.ts`'s `listZones`/`writeZones`), same shape, no token minted or
held anywhere for it. The studio section (`/@<user>/studio/location`) has no
map or geocoder wired in — the server's own geocoder
(`POST /api/v2/geocode`) is bearer-only and the browser holds no token — so a
zone's coordinates are typed in, or filled from the browser's own current
position.

**`writeZones` deletes every trip's `track-recent.json` the moment it
runs — B2536 security review.** `track.json` is left for the next import or
explicit `POST …/track` to pick a new zone up, as it always has been; the
live tail cannot wait for that, because a reader with `mayReadLiveTrack`
still true would go on seeing it in the meantime. A zone the owner just
typed in cuts the live dot off from the moment they save it, not from the
next time their phone happens to check in — deleted outright, not
re-derived, so the honest interim answer is nothing drawn at all rather
than a line computed against the zone that has not landed yet. The
standalone purge (`purgeGpsHistory`, B1843 addendum, below) does the same:
whole months of history disappearing from the store must not leave a tail
still answering for fixes that no longer exist.

**Any saved zone** is what `hasHomeZoneOrDeclined` (`lib/gps/api.ts`) looks
for, whatever its label — "home", "Zuhause" and "otthon" are the same answer.
B2196's recorder needs one yes-or-no answer before it may start at all —
either a zone exists, or the owner has explicitly said they do not want one. The decline itself lives beside `exclude.json`, not
inside it — `content/<user>/gps/home-declined.json`, `{"declined": true}` —
because "the owner said no" is a different fact from "here is a place",
recorded next to the array rather than folded into its one documented shape.
Both files are under `gps/`, so both are covered by the same private-store
rules as `exclude.json` itself: never exported, never reachable by any route
under `app/` except through `lib/gps/api.ts`.

## What it looks like

A thin line under the markers — navy-500, 70% opacity, 2.2px. (0.4 and 1.5px
was the first attempt and was *invisible* on the green basemap: the paths were
in the DOM at the right coordinates and could not be seen at all.) The map's frame is
still computed from the trip's stops alone — a track that wandered outside them
must not be able to zoom the whole map out to fit itself, and the viewBox clips
what falls outside.

## A day's own place — the one reader, B2200

`placeForDay(user, tripId, date)` in `lib/gps/api.ts` answers a new day with
where the owner was, so the studio's new-day flow can ask "you were in
Chiang Mai — use it?" instead of leaving the field blank. It is the one
function anywhere that reads a position out of the store, and it is built to
be exhaustive about what it refuses to give back:

- **Private zones removed first**, with the same `readExcludeZones` /
  `isExcluded` the trip-track derivation uses. An unreadable zone list fails
  closed — `null`, not a guess.
- **The place is wherever the remaining fixes add up to the most dwell
  time** that day (`from` this fix to the next, capped at the same two-hour
  gap `enrich.ts` breaks a line at), not the single most common fix and not
  an average of coordinates.
- **Named by the offline `reverseGeocode`** (`lib/ingest/geo.ts:192`, places
  above 1,000 people, city level) — never Photon or any other third party,
  which would send the owner's positions off the server.
- **Only a date inside the trip, and not after today.** The trip stores no
  timezone, so "today" and the day's own bounds are both read in UTC — the
  same simplification `deriveTrack`'s own doc comment already names for the
  trip-wide line.
- **Never a coordinate out.** The answer is `{ name, country }` and nothing
  else. A day that wants a point for what it accepted uses the geocoded
  place's own centroid, never a fix this function read.

Reachable only from the studio's new-day page, under the owner's own browser
cookie (`isHelperOwner`) — a bearer token, including a journal-wide agent
token, is refused there by construction, the same as every other page under
`/@<user>/studio`. Behind `features.routeRecording`, off by default like every
optional capability; `/api/health` explains why it is off when it is.

## "Your route" — the owner's own recorded trips, B2226

The studio's location page (`/@<user>/studio/location`) grows a second
section, "Your route", the owner's own view of what their phone or an import
has actually recorded — one trip's list, a preview of its raw line, and a
way to delete a trip's or a single day's recording. Three functions in
`lib/gps/api.ts`, none reachable from `/api/v2` — the owner decided on
2026-09-24 that there is no agent door onto any of this:

- **`recordedTrips(user)`** — for each trip whose dates hold at least one
  fix, `{ tripId, title, start, end, daysRecorded, tripDays, lastReceived }`.
  Reuses `coverageOf`, the same "N of M days" counter the import peek screen
  already uses. **Counts and a timestamp, never a coordinate** — this is not
  a third exception to "nothing reads gps/ but the two named readers", it is
  the same shape `coverageOf` already had before this ticket.
- **`ownerTripLine(user, tripId)`** — the second exception, after
  `placeForDay`. `{ segments: [{ day, points }] }` over the trip's own
  dates, with **no** 24-hour recency cap, **no** published-day filter and
  **no** end-trimming — the owner looking at their own history is not the
  audience those three protect. It still thins, simplifies (50 m) and
  breaks at gaps, the same as every other derivation, so a long trip stays a
  few thousand points rather than tens of thousands. Private zones are not
  applied either, for the same reason; the page says so in one sentence.
- **`deleteTripRecording(user, tripId, date?)`** — removes every fix inside
  the trip's own window, or one day's local-midnight window (that day's own
  `timezone`, else UTC), with `deleteRange`'s usual second-rounding, then
  re-derives that trip's `track.json` (`deriveTripTrack`, which already
  deletes an empty result). **The phone's own upload buffer is unaffected**
  — a position already queued on the device before this ran still arrives
  later; the page says so.

Three helper doors, all under `app/api/helper/[user]/gps/` and guarded
exactly like `.../gps` (B1843 addendum): `isHelperOwner`, then the resolved
address compared against `config.json`'s own `owner.email` — the operator's
admin cookie is refused the same as any other journal's owner would be for
somebody else's. `GET .../gps/trips`, `GET .../gps/line?trip=`, and
`DELETE .../gps/trip?trip=&date=` (the day is optional; absent deletes the
whole trip). `DELETE` also checks `foreignOrigin`, the same second layer
`.../gps`'s own real purge uses. Every response carries
`Cache-Control: private, no-store`.

## How the iPhone recorder tracks — timeline-style

`ios/App/App/Recorder.swift` records the way a location timeline does,
not like navigation left running. Three low-power services run for as long
as a trip is armed, keep running after the app is swiped away, and relaunch
it when they fire: **significant location changes** (~500 m moves),
**visits** (arrived somewhere / left it) and a **150 m fence** around where
the phone last settled. GPS itself (`startUpdatingLocation`) runs only
between "left a place" and "stopped somewhere" — a visit arrival or iOS's
own automatic pause turns it off and drops the fence; leaving the fence, a
visit departure or a significant change turns it back on. A visit's arrival
and departure are buffered as ordinary fixes; `store.ts` de-duplicates.

`showsBackgroundLocationIndicator` is `false`, so there is no blue
status-bar pill. That holds only with **"Always"**: under "While Using",
iOS shows the pill regardless and none of the three services run, which is
why the studio section never arms without first walking the owner to
"Always". It asks "While Using" first, then — once granted, still in the
foreground — requests the upgrade, which iOS shows at once as "Change to
Always Allow". iOS offers that prompt only once per install
(`recorder-always-asked` remembers it), after which the section gives the
exact Settings path instead. `locationPermission()` reports
`{ status, precise, canAskAlways }` and the section shows it under the
switch at all times, Precise Location included, since without it every fix
is kilometres wide.

## Hide a spot, hide a stretch, name a stretch — B2539, D8 C

GPS makes mistakes, and some places should never be public — a hotel, a
friend's flat, a private moment the owner does not want plotted. The Algarve
find that named this ticket: a boat trip with dolphins came out of Google
Timeline as "in passenger vehicle, 43 km", because a phone's best guess at
transport mode is a guess. The owner can now say otherwise, per trip:

```json
content/<user>/trips/<trip>/track-edits.json
{
  "hiddenSpots": [{ "id": "…", "lat": 37.1, "lon": -8.8, "radiusM": 200 }],
  "hiddenStretches": [{ "id": "…", "from": "2026-06-22T14:00:00Z", "to": "2026-06-22T16:00:00Z" }],
  "namedStretches": [{ "id": "…", "from": "2026-06-22T10:00:00Z", "to": "2026-06-22T12:00:00Z", "label": "Boat trip · dolphins" }]
}
```

A **hidden spot** is a circle, the same shape as a private zone
(`ExcludeZone`, above) but scoped to one trip rather than the whole journal —
a place visited once on this trip is not "everywhere the owner has ever
been near". A **hidden stretch** is a time range with nothing said about it.
A **named stretch** is the same time range with a label a reader's map may
draw. Naming does not hide: every fix in a named stretch still reaches the
line unless some other rule also cuts it. `id` is assigned server-side on
write (`writeTrackEdits`, `lib/gps/api.ts`) for anything new, never
client-chosen, so two tabs adding a hidden spot at once cannot collide.

**Hiding never deletes a position.** The store keeps every fix; only what a
reader is ever shown changes, applied at exactly the same place a private
zone already is — inside `deriveTrack` (`lib/gps/enrich.ts`), which breaks a
run wherever a fix falls inside a hidden spot or a hidden stretch, the same
way it already breaks one at a private zone. Read once per derivation
(`deriveTripTrack`, `lib/gps/api.ts`) and threaded into **both**
`track.json` and `track-recent.json` (the live tail) — never into
`ownerTripLine`, the owner's own unfiltered view, which is deliberately not
the audience a hidden spot or stretch protects. Because the cut happens at
derivation, every reader of the resulting file is already safe with no
further filtering: both map pages (through `readerTrack`), the export
(`lib/exportZip.ts`, which re-derives through `readerTrack` at export time
too) and the trip's story/card build (`lib/tripView.ts`) all pass through
the same two files.

**A named stretch's own label and point** are computed at that same
derivation step — the fix closest to the stretch's own middle instant, among
the fixes that would actually be drawn (in range, on a real trip date, not
cut by any other rule) — and stored as `Track.labels` (`lib/gps/track.ts`)
alongside the file's `segments`. `namedStretchLabels(user, tripId,
visibleDates, live)` is the reader-safe door onto it, filtered to this
reader's own visible dates the same way `readerTrack`'s segments are — a
label, never the line, one point on it. It does not draw anything; a map
page choosing how to draw that point is a separate ticket (B2537).

**Writing edits re-derives immediately.** `writeTrackEdits` calls
`deriveTripTrack` before it returns, the same urgency `writeZones` already
has for private zones and for the same reason: a hidden spot the owner just
saved must cut the reader-facing line off from the moment it is saved, not
from the next import or explicit `POST …/track`.

**Doors**, mirroring `gps/zones` exactly — owner only, a trip-scoped token
refused even for its own trip, because a hidden spot changes what every
reader of the trip is shown, a bigger authority than an ordinary write to it:

```http
GET  /api/v2/<user>/trips/<trip>/track-edits
PUT  /api/v2/<user>/trips/<trip>/track-edits
```

`/api/web/<user>/trips/<trip>/track-edits` is the studio's own cookie-only
twin — Studio › Location's per-trip "Hide a spot, hide a stretch, name a
stretch" panel, folded under a recorded trip's day list, uses it.

**Never in export or sync, the same reasoning `track-recent.json` gets.**
`track-edits.json` is decided as trip content — it lives beside `track.json`
in the trip's own folder, because it is inherently about one trip's line —
but it still carries coordinates and times the owner chose meaning "nobody
outside this journal", so it gets the same two exclusions the live tail
does: `lib/exportZip.ts` skips it outright in every export scope, and
`lib/sync/manifest.ts`'s `inSync` refuses it, so a `write:content` bearer
token — the kind that sits in agent scrollbacks — cannot list or fetch it
through the sync surface either. `test/gps-track-edits.test.ts` and
`test/track-edits-route.test.ts` are the tests.

## What this does not do

No live tracking (B666 is the endpoint an app like OwnTracks or Overland would
post to; a PWA cannot do background geolocation, so there is no point building
one). No per-day tracks on a public map, no speed or elevation, no
map-matching to roads, and no reading of the store from the web at all
beyond the three named readers above — `placeForDay`, `recordedTrips` and
`ownerTripLine`.
