# Importers

**This folder is MIT.** The rest of the repository is not (see the root
`LICENSE`). It is carved out on purpose: an importer for a service nobody here
has heard of should be writable, publishable and copyable between instances
without anybody having to read a licence first.

## What an importer is

One file. It turns a file somebody exported from somewhere else into plain
position fixes:

```ts
import { isSaneFix, type Importer } from "./types";

const importer: Importer = {
  id: "my-tracker",
  label: "My Tracker export",
  detect: (head, filename) => filename.endsWith(".mytrack"),
  parse: (text) => [{ t: 1762410000000, lat: 47.38564, lon: 8.21819 }],
};

export default importer;
```

Drop it in this folder. Nothing registers it and no list needs editing — the
folder *is* the registry, read at startup, and `npm run gps -- formats` will
list it back to you.

That is the whole job. An importer has no network, no disk, no database and no
idea what a journal or a trip is. Everything downstream — thinning, storage,
clipping to one trip, drawing a line — is Fernscout's, and is deliberately not
reachable from in here.

## The contract

`types.ts` is the authority; it is forty lines and worth reading. In short:

| | |
| --- | --- |
| `id` | lowercase, dashes. Written into a trip's `track.json` as the credit for where the line came from, so it outlives the import |
| `label` | what a person calls this export |
| `detect(head, filename)` | given the first 64 kB and the name — is this yours? |
| `parse(text)` | every fix, in any order |

A `Fix` is `{ t, lat, lon }`, with `t` in **milliseconds since the epoch, UTC**.
Nothing else. No accuracy, no altitude, no speed, no mode of transport — if
one of those ever earns its place it will be an optional field, and until then
its absence is what keeps every importer the same size.

Three rules that are not obvious:

- **Be strict in `detect`.** A loose one that says yes to somebody else's
  export is worse than a tight one that says no to its own: `--format <id>`
  always overrides, and a wrong parse is silent.
- **Skip what does not parse; do not throw.** These exports are large and their
  vendors change them without notice. One unreadable segment must not cost the
  other ten months. Throw only when the file is not yours at all.
- **Never invent.** No interpolating between two fixes, no snapping to a road,
  no filling a gap. A hole in the data is a fact about the data.

## Not writing TypeScript?

Then do not write an importer. Have your script print the neutral format and
use `fixes.ts`, which is already here:

```jsonl
[1762410000, 47.38564, 8.21819]
{"t": "2025-11-06T05:00:00Z", "lat": 47.38564, "lon": 8.21819}
```

One fix per line, `t` as an ISO instant or epoch seconds or milliseconds. Then
`npm run gps -- import <user> out.jsonl`.

## Testing yours

```bash
npm run gps -- formats                       # is it listed?
npm run gps -- import <user> <file> --dry-run  # what would it read?
```

`--dry-run` reads and thins and writes nothing, and prints how many fixes came
out, over what span. That is the fastest check that a new importer works: a
count that is zero, or a span running to 1970, is the parse being wrong.

## What is here

| | |
| --- | --- |
| `google-timeline.ts` | Google Maps Timeline, the phone export (Settings → Location → Timeline → Export) |
| `google-records.ts` | Google Takeout `Records.json`, the older account-side history |
| `gpx.ts` | GPX — Garmin, Strava, GPSLogger, OsmAnd, anything with a track |
| `fixes.ts` | the neutral JSON Lines format above |

## Where the data goes, and why that matters

Everything an importer reads is somebody's complete location history: every
address they sleep at, every place they work, everywhere they have been ill.
Fernscout keeps it out of reach — the store it lands in is served by no route
and is in no export, and what the site draws is a separate derived file
clipped to one trip.

An importer is not where that is enforced, but it is where it starts. Take
what the file says and nothing more.
