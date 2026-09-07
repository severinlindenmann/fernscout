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

- **No route reads it.** There is no API that returns a position.
  `test/gps-store.test.ts` asserts nothing under `app/` imports
  `lib/gps/store.ts` or `lib/gps/enrich.ts`.
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

```bash
npm run gps -- formats
npm run gps -- import <user> ~/Downloads/Timeline.json [--dry-run]
npm run gps -- import <user> walk.gpx --format gpx
```

The format is detected from the file; `--format` overrides. `--dry-run` reads
and thins and writes nothing, which is the fastest way to check a new
importer.

**Thinning: a fix is kept if it is five minutes after the last kept one, or
250 metres from it.** Time alone logs a phone fidgeting on a bedside table all
night; distance alone is fine until a motorway, where five minutes is an
eight-kilometre chord and the road stops looking like a road. A real ten-month
Google export came out at 16,315 fixes and 508 kB.

Re-importing the same file changes nothing — the thinning is applied to the
merged set, and one second holds one position.

### Adding a format

`importers/` is **MIT-licensed**, unlike the rest of this repository, and it is
its own registry: drop a file in and it works. See `importers/README.md`.

If your tool is not TypeScript, do not write an importer — have it print JSON
Lines and use the `fixes` format that is already there.

## Deriving a trip's line

```bash
npm run gps -- enrich <user>/<trip> [--dry-run]
```

Four things happen, and three are about what does not come out:

1. **Clipped to the trip's dates.** Everything outside is the rest of somebody's
   life. (Bounded in UTC — a trip that ended at 01:00 local in Tokyo loses its
   last hour, which is cheaper than guessing a timezone.)
2. **Private zones removed**, and the line cut there. Clipping by date does not
   help on the morning of day one, which starts at the front door.
3. **Broken at gaps** longer than two hours. A flight is a hole in the data, and
   a hole is drawn as a break rather than a straight line across France.
4. **Simplified** (Douglas–Peucker, 50 m), so a ten-day trip is about 500 points
   and 10 kB rather than forty thousand points.

Re-run it whenever the store gains fixes for those dates. It only ever rewrites
that one file.

### Private zones

`content/<user>/gps/exclude.json`:

```json
[{ "label": "home", "lat": 47.38564, "lon": 8.21819, "radiusM": 500 }]
```

**Deliberately not in the journal's `config.json`**, which goes into every
export, including the one an anonymous visitor can download. A home address
written there to keep it off the map would have been published by the very act
of hiding it.

An unreadable list is refused rather than ignored: failing open here puts
somebody's front door on a public map.

## What it looks like

A thin line under the markers, at 40% opacity, in navy-500. The map's frame is
still computed from the trip's stops alone — a track that wandered outside them
must not be able to zoom the whole map out to fit itself, and the viewBox clips
what falls outside.

## What this does not do

No live tracking (B666 is the endpoint an app like OwnTracks or Overland would
post to; a PWA cannot do background geolocation, so there is no point building
one). No per-day tracks, no speed or elevation, no map-matching to roads, and
no reading of the store from the web at all.
