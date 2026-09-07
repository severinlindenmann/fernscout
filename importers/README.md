# Importers

**This folder is MIT.** The rest of the repository is not (see the root
`LICENSE`). It is carved out on purpose: an importer for a service nobody here
has heard of should be writable, publishable and copyable between instances
without anybody having to read a licence first.

## The kind of data is the folder

```
importers/
  schema.ts       what every importer is, whatever it reads
  gps/            positions — `{"kind": "gps"}`
    schema.ts     ← start here: the row type, and the function that checks yours
    index.ts      the list the server bundles — add your file here too
    google-timeline.ts  google-records.ts  gpx.ts  fixes.ts
  costs/          bank statements — `{"kind": "costs"}`
    schema.ts     Payment, and its own check
    index.ts      revolut.ts
```

Both are read by the same call, `POST /api/v1/<user>/import`, keyed by kind.

**`<kind>/schema.ts` is the whole contract for that kind.** Read it, produce
the row it names, call the check it exports, and add your file to that kind's
`index.ts`. There is nothing else to know.

A new **format** for something already here is a file in that kind's folder — a
Monzo statement goes in `costs/`, a Strava export in `gps/`. A new **kind** is a
new folder with its own `schema.ts` naming its own row type, and its own writer
behind the same call. `Payment` and `Fix` have nothing to say to each other,
and one folder holding both would be a pile to filter rather than a place to
look.

`importers/schema.ts` is the whole of what they share: `Importer<Row>`, one
generic parameter, no base class and no plugin interface.

## What an importer is

One file:

```ts
import { type GpsImporter } from "./schema";

const importer: GpsImporter = {
  id: "my-tracker",
  label: "My Tracker export",
  detect: (head, filename) => filename.endsWith(".mytrack"),
  parse: (text) => [{ t: 1762410000000, lat: 47.38564, lon: 8.21819 }],
};

export default importer;
```

Drop it in `gps/`, and add it to `GPS_IMPORTERS` in `gps/index.ts`.
`GET /api/v1/<user>/import` will list it back to you.

The line in `index.ts` is not ceremony: a bundler cannot trace a directory
scan, so an importer that is only a file would be *missing* from a production
build and the failure would appear on the deployed instance and nowhere else.
The test walks the folder and fails with the line to add.

**Then run the check.** `<kind>/schema.ts` exports one, and it tells you what is
wrong in words:

```ts
import { checkGpsImporter } from "./schema";

const problems = checkGpsImporter(importer, importer.parse(myExport));
// [] means it holds up. Otherwise, for instance:
//   "3 of 812 fixes are not on Earth — first: {"t":…,"lat":8.1,"lon":471}.
//    Latitude is ±90 and longitude ±180; a pair the wrong way round is the
//    usual cause"
//   "812 fixes are outside 2001–2100 — first: 1970-01-21T…Z. t is
//    milliseconds since the epoch; seconds land in 1970"
```

`POST /api/v1/<user>/import` with `"dryRun": true` runs exactly that function
against your real export and writes nothing, so you never have to import the
check yourself unless you want it in your own test.

That is the whole job. An importer has no network, no disk, no database and no
idea what a journal or a trip is. Everything downstream — thinning, storage,
clipping to one trip, drawing a line — is Fernscout's, and is deliberately not
reachable from in here.

## The contract

`schema.ts` — both of them — is the authority, and between them they are under
a hundred and fifty lines. In short:

| | |
| --- | --- |
| `id` | lowercase, dashes, unique within its kind. `--format <id>` is how somebody overrides detection |
| `label` | what a person calls this export |
| `detect(head, filename)` | given the first 64 kB and the name — is this yours? |
| `parse(text)` | every row, in any order |

A `Fix` — `gps/`'s row — is `{ t, lat, lon }`, with `t` in **milliseconds since
the epoch, UTC**.
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
use `gps/fixes.ts`, which is already here:

```jsonl
[1762410000, 47.38564, 8.21819]
{"t": "2025-11-06T05:00:00Z", "lat": 47.38564, "lon": 8.21819}
```

One fix per line, `t` as an ISO instant or epoch seconds or milliseconds. Send
it as `{"kind": "gps", "format": "fixes", "text": …}`, or stage the file and
name it by id.

## Testing yours

```http
GET  /api/v1/<user>/import                          is it listed?
POST /api/v1/<user>/import  {"kind":"gps", "text": "…", "dryRun": true}
```

The dry run parses, runs `checkGpsImporter`, says how many fixes came out and
over what span, and writes nothing. A count of zero, a span running to 1970, or
a complaint about the Earth is the parse being wrong.

There is no CLI. Everything here runs on the server, reached over the API —
which is the point: the person with the export usually has no shell on the
machine the journal lives on.

## What is here

**`gps/` — positions.**

| | |
| --- | --- |
| `google-timeline.ts` | Google Maps Timeline, the phone export (Settings → Location → Timeline → Export) |
| `google-records.ts` | Google Takeout `Records.json`, the older account-side history |
| `gpx.ts` | GPX — Garmin, Strava, GPSLogger, OsmAnd, anything with a track |
| `fixes.ts` | the neutral JSON Lines format above |

**`costs/` — bank statements.**

| | |
| --- | --- |
| `revolut.ts` | a Revolut consolidated statement, as the app exports it |

One bank, and the shape of the next one is written down rather than guessed at:
rows of `{date, amount, currency, description}` with the sign the statement
wrote, and **no category** — what a payment was *for* is the owner's decision,
which is why a `costs` import writes nothing by itself.

## Where the data goes, and why that matters

This section is about `gps/` in particular. Everything one of those importers
reads is somebody's complete location history: every
address they sleep at, every place they work, everywhere they have been ill.
Fernscout keeps it out of reach — the store it lands in is served by no route
and is in no export, and what the site draws is a separate derived file
clipped to one trip.

An importer is not where that is enforced, but it is where it starts. Take
what the file says and nothing more.
