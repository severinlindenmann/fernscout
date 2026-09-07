---
id: B665
title: A trip's map draws straight lines between days, because nothing holds where somebody actually went
type: FEATURE
priority: medium
complexity: high
area: maps, content-model, privacy, ingest
found: "2026-09-07T07:49:28Z"
started: "2026-09-07T08:00:30Z"
session: 1d31e523-3a22-4905-82fd-39e3d55289f5
claimed: "2026-09-07T08:00:30Z"
---

# B665 — A trip's map draws straight lines between days, because nothing holds where somebody actually went

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

A trip's maps know a handful of points — one coordinate per day, one per
photograph — and join them with straight lines. `WorldMap` draws a leg from
place to place and `MiniMap` a polyline through the days; a week of driving
through the Alps renders as four chords across the mountains. The shape of the
travel, which is most of what a reader recognises, is not in the content model
at all.

The data exists, on the traveller's phone: Google Timeline, or any of the
logger apps, hold the actual line. What is missing is somewhere to put it and
a way to boil it down into something a trip owns.

**This is location data about a person's whole life, which is why the shape
below is what it is.** A Timeline export is every address they sleep at, every
place they work, every clinic they visited. It must not be readable over HTTP,
must not be in an export, and must not be what the site renders — what the
site renders is a *derivative* clipped to one trip, and the two are different
files with different rules.

## Work

Three pieces, and the seam between the first two is the whole point.

### 1. The private store — `content/<user>/gps/YYYY-MM.jsonl`

One line per fix, `[epochSeconds, lat, lon]`, five decimal places (≈1 m).
Month files rather than one `gps.json`: an import appends rather than
rewriting a decade, a month is cheap to delete, and nothing has to be held in
memory whole.

**Thinning on the way in: keep a fix if it is ≥5 minutes after the last kept
one *or* ≥250 m from it.** Five minutes alone is not enough — five minutes on
a motorway is an eight-kilometre chord and the road stops being recognisable —
and distance alone logs a fidgeting phone standing still. A year of this is a
few megabytes.

**Rules that make it private, each of which is a test:**

- No route reads it. Not `/api/v1/**`, not a page, not `/media/…`. A test
  asserts nothing under `app/` imports `lib/gps/store.ts`, the way
  `test/postcard-orders.test.ts` guards `sendOrder`.
- Not in `exportZip` — `appendUserContent` walks `trips/` and `config.json`
  only, so this is true today and a test pins it.
- Inside B661's storage ceiling, which is free: `lib/storageQuota.ts` counts
  the whole of `content/<user>/`.
- It is in the owner's filesystem backup (`scripts/backup.sh`), because it is
  theirs.

### 2. Import — `npm run gps:import <user> <file>`

Reads a dropped export and appends to the store. Formats, in this order of
who actually has one:

| | |
| --- | --- |
| Google Timeline (phone export) | `semanticSegments[].timelinePath[]`, points as `"geo:lat,lng"` with a time |
| Google Takeout Records | `locations[]`, `latitudeE7` / `longitudeE7` / `timestamp` |
| GPX | `<trkpt lat lon>` with `<time>` |

Parse defensively and skip what does not parse — these files are large,
versioned by Google without notice, and one unreadable segment must not lose
the import. Report counts: read, kept, skipped.

Where the file arrives from is B663's inbox (`inbox/files/`), and this is the
first thing that reads one — but the CLI takes a path, so it does not block on
B663.

### 3. Derivation — `npm run gps:enrich <user>/<trip>`, writing `trips/<id>/track.json`

The trip's own copy, and **the only thing anything renders**:

```json
{ "generated": "2026-09-07", "source": "google-timeline",
  "segments": [ { "from": "2026-06-01T08:12:00Z", "points": [[46.12345, 7.21456], …] } ] }
```

- **Clipped to the trip's dates**, `start`..`end` inclusive, in the trip's own
  local sense of a day. Nothing before, nothing after — that is where the
  house is.
- **Private zones dropped.** A `gps.exclude` list in the user's `config.json`
  — `{ lat, lon, radiusM }` — and every point inside one is removed, splitting
  the segment. Without it a track that starts at the front door publishes the
  front door, and clipping by date does not help on the morning of day one.
- **Simplified**, Douglas–Peucker at ~50 m. A fortnight thins from ~40k points
  to a few thousand; the file stays small enough to ship in the page props.
- **Split into segments on a gap** — more than about 2 hours with no fix, or
  an implausible jump. A flight leaves a hole, and a hole must be a break in
  the line rather than a straight line drawn through it.
- **Idempotent**, and it never reads back what it wrote: the store is the only
  input.

Once written, the trip is self-contained. **Deleting `content/<user>/gps/`
entirely leaves every trip rendering exactly as before** — that is the
acceptance test, and it is the reason for the two-file shape.

`track.json` inherits the trip's visibility because it is inside the trip
folder and is read through the same gate as everything else there. It goes
into the trip export, which is correct: it is the trip's route.

### 4. Rendering

`WorldMap` gains an optional `track` prop and draws the segments as a thin,
faint line *under* the markers and legs — the big dots stay the story, the
track is the texture between them. Frame from the places as now, not from the
track: the viewBox clips a stray tail, and a track must never be able to blow
the frame out. `MiniMap` and the trip hero follow if it looks right; check it
on `/docs/branding` rather than by argument.

**Not doing now:** live tracking (B666), any UI for importing, per-day tracks,
speed or elevation, map-matching to roads, and any reading of the store from
the web at all. `plan.md` is unaffected — that is the intended route, this is
the taken one.

## Acceptance

- `gps:import` on a real Google Timeline export writes month files, and a
  second run of the same file adds nothing.
- Thinning holds: no two kept fixes within 5 minutes *and* 250 m of each
  other.
- `gps:enrich` writes `track.json` with segments broken at gaps, no point
  outside the trip's dates, and no point inside a `gps.exclude` zone. A test
  covers each of the three.
- `rm -rf content/<user>/gps` and every trip page renders identically.
- A test asserts nothing under `app/` imports the store module, and that
  `export.zip` in either scope contains no `gps/` path.
- The trip map draws the track under the markers, and a trip with no
  `track.json` is unchanged.
- `npm run verify` passes.
