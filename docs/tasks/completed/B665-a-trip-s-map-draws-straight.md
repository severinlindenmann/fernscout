---
id: B665
title: A trip's map draws straight lines between days, because nothing holds where somebody actually went
type: FEATURE
priority: medium
complexity: high
area: maps, content-model, privacy, ingest
found: "2026-09-07T07:49:28Z"
started: "2026-09-07T08:00:30Z"
merged: "2026-09-07T08:28:55Z"
completed: "2026-09-07T13:13:23Z"
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

**Five things changed while building, and each has its reason below**: the
importers moved into an MIT-licensed folder of their own, the private zones
moved *out* of `config.json`, the source credit was dropped, the CLI became one
command rather than two, and the thinning rule grew a third clause it turned
out to need.

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

**A third clause the thinning rule turned out to need.** Five minutes *or* 250
metres was not enough on the real export: Google ends an activity and starts
the next segment at the same instant, hundreds of metres apart, and that pair
is far enough apart to survive the distance rule — *and* to make the next
import's copy of it survive as well. Re-importing the same file grew the store
by 1,191 positions, every time, for ever. **One second holds one position**,
and the first wins. Timestamps are also rounded to whole seconds *before*
thinning rather than only on the way to disk, or a re-parsed fix still carrying
its milliseconds sorts either side of the one already stored.

### 2. Import — `npm run gps -- import <user> <file>`

**One command with subcommands, not two npm scripts.** `formats`, `import` and
`enrich` share the importer discovery and the argument parsing, and three
entries in `package.json` for one file buys nothing.

Formats, in this order of who actually has one:

| | |
| --- | --- |
| Google Timeline (phone export) | a flat array of segments: `timelinePath[]` points as `"geo:lat,lng"` at a minute offset, plus `activity` start/end and `visit` places |
| Google Takeout Records | `locations[]`, `latitudeE7` / `longitudeE7` / `timestamp` |
| GPX | `<trkpt lat lon>` with `<time>` |
| plain fixes | JSON Lines, `[t, lat, lon]` — the door for a tool that is not TypeScript |

Parse defensively and skip what does not parse — these files are large,
versioned by Google without notice, and one unreadable segment must not lose
the import.

**They live in `importers/`, and that folder is MIT.** Not planned, and asked
for while building: a parser for somebody's device is useful outside this
project entirely, and adding one should not mean reading a non-compete clause
first. The folder is its own registry — `scripts/gps.mts` reads the directory
and imports what it finds — so contributing a format is dropping a file in,
with no list here to edit. `importers/types.ts` is the contract, forty lines,
and `importers/README.md` is how to implement it. The carve-out is stated in
the root `LICENSE` and the README; `knip.jsonc` gets the folder as an entry
point, because nothing names an importer statically and that is the point.

The fourth importer, `fixes`, is the answer to "I already have a script".
Print JSON Lines and no importer needs writing at all.

Where the file arrives from is B663's inbox (`inbox/files/`), and this is the
first thing that reads one — but the CLI takes a path, so it does not block on
B663.

### 3. Derivation — `npm run gps -- enrich <user>/<trip>`, writing `trips/<id>/track.json`

The trip's own copy, and **the only thing anything renders**:

```json
{ "generated": "2026-09-07T08:12:00.000Z",
  "segments": [ { "from": "2026-06-01T08:12:00Z", "points": [[46.12345, 7.21456], …] } ] }
```

**No `source:` field, dropped deliberately.** The plan had one crediting the
importer, by analogy with `weatherData` — but that analogy is wrong. Weather
names its source because it is a third-party measurement the reader is being
asked to trust; a track is the owner's own record of their own movement, and
there is nothing to attribute. Carrying it would also have meant per-fix
provenance in the store, which is a column to keep correct for a line nothing
displays.

- **Clipped to the trip's dates**, `start`..`end` inclusive, in the trip's own
  local sense of a day. Nothing before, nothing after — that is where the
  house is.
- **Private zones dropped**, every point inside one removed and the segment
  split there. Without it a track that starts at the front door publishes the
  front door, and clipping by date does not help on the morning of day one.

  **Not in `config.json`, which is where this ticket said to put them.**
  `appendUserContent` puts that file into *every* export, including the
  open-to-link one an anonymous visitor can download — so a home address
  written there to keep it off the map would have been published by the act of
  hiding it. They live in `content/<user>/gps/exclude.json` instead, inside the
  folder that is already in no export and behind no route. An unreadable list
  is refused rather than ignored, for the same reason.
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

- `gps import` on a real Google Timeline export writes month files, and a
  second run of the same file adds nothing.
- Thinning holds: no two kept fixes within 5 minutes *and* 250 m of each
  other.
- `gps enrich` writes `track.json` with segments broken at gaps, no point
  outside the trip's dates, and no point inside an exclusion zone. A test
  covers each of the three.
- `rm -rf content/<user>/gps` and every trip page renders identically.
- A test asserts nothing under `app/` imports the store module, and that a
  built `export.zip` in either scope carries the trip's `track.json` and no
  `gps/` path.
- The trip map draws the track under the markers, and a trip with no
  `track.json` is unchanged.
- Somebody has looked at it, not only asserted it — `check-a-drawing`.
- `npm run verify` passes.

## What was verified

Against a real ten-month Google Timeline export (3,855 segments, 22,659 fixes),
in a scratch `CONTENT_DIR` so that nobody's location history went near this
repository:

- **Import.** 22,659 fixes read, thinned to **16,315** across eleven month
  files, **508 kB** on disk. A second and third run: `was 16315` → `now 16315`,
  byte-identical files.
- **Enrich.** A ten-day trip came out as **21 segments, 471 points, 10 kB** —
  and the flight out shows as exactly what it is: one segment ending near
  Basel, the next beginning in the Algarve thirteen hours later, with no line
  drawn between them.
- **The neutral importer, end to end.** A synthetic route through the
  `alps-2024` passes (invented coordinates, JSON Lines) imported through
  `fixes`, enriched, and rendered.
- **The drawing.** Screenshotted at 1200px and at 390px. The first attempt —
  navy-500 at 0.4 opacity, 1.5px — was **invisible**: the paths were in the
  DOM at the right coordinates and could not be seen at all until they were
  recoloured in the inspector. Settled at 0.7 and 2.2px, which reads as a line
  that wandered without competing with the markers.
- `npm run verify`: 315 files, 4,117 tests. `npm run unused`: clean.
