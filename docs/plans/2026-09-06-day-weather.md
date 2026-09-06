# B325 — what the weather actually was

Written before the work, 2026-09-06. Kept as the record of intent; not
corrected afterwards (see `docs/README.md` on `docs/plans/`).

## The problem this has to solve without breaking the one rule

A day already carries a date and, usually, a coordinate. Those two values are
enough to look up what the weather at that place on that day actually was.
Nothing did, and `AGENTS.md` forbids the only route that was available —
*"no weather nobody mentioned"* — because that route was guessing.

A measured observation from a public archive, at a coordinate the person
supplied, on a date they supplied, labelled as coming from that archive, is not
what the rule prohibits. It is the thing the rule exists because we could not
otherwise have. **What makes it safe is the labelling**, so the provenance is
not an optional field: nothing is stored without a source and a timestamp, and
the page never renders a reading without saying where it came from.

## The provider

**Open-Meteo.** Chosen over the alternatives for one property above all: **no
API key**. Every optional capability here is off by default and must be
*absent rather than broken* when disabled, and one that needs no secret is one
a self-hoster can actually turn on. Both endpoints were driven by hand before
this was written:

```
https://archive-api.open-meteo.com/v1/archive?latitude=…&longitude=…
  &start_date=…&end_date=…&daily=weather_code,temperature_2m_max,
  temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=auto

https://api.open-meteo.com/v1/forecast?…same shape…
```

Both answer JSON with `daily.weather_code` as a **WMO code**, temperatures in
°C, precipitation in mm, wind in km/h. The archive is ERA5 reanalysis and lags
real time by roughly five days; the forecast endpoint serves the last ~92 days
including today. **Splitting on the age of the day is what removes the lag
hole entirely** — a day written the evening it happened gets real numbers,
which is the ordinary case for this software.

**Licence — the one fact not verified before the work.** Open-Meteo publishes
its data under CC BY 4.0 with attribution, free for non-commercial use, and
its own API code under AGPL. `curl` could not retrieve
<https://open-meteo.com/en/license> from this machine (an empty 100-byte
response), so that sentence is from prior knowledge and **must be read off the
page and confirmed before this merges**. The attribution itself is not in
doubt and is built either way: every rendered reading credits "Open-Meteo",
linked.

## The shape on disk

Two fields, both optional, in the day's own frontmatter:

```yaml
weather: true
weatherData: { tempMin: 30.2, tempMax: 39.4, code: 53, precipitation: 2.7, windMax: 22.9, source: "open-meteo", recordedAt: "2026-09-06T09:14:00.000Z" }
```

`weather:` is **the request** — a person or an agent asking for a lookup.
`weatherData:` is **the answer**, and the server is the only thing that writes
it from a lookup.

A YAML flow mapping on one line rather than a nested block, because
`spliceScalar` in `lib/api/entries.ts` already replaces, inserts and removes
exactly one line and a nested block would need a fourth splicer beside
`spliceCosts`, `spliceTranslations` and `spliceCaptions`. `costs:` items are
already written this way.

**One provenance timestamp, `recordedAt`, not two.** For a lookup it is the
instant the fetch happened; for a hand-supplied reading it is when the reading
was taken. Splitting it into `fetchedAt` and `observedAt` would be two fields
for one question — *when is this true of* — and every reader would have to
know which one to look at.

## The two write paths, and the line between them

**A lookup.** `weather: true` + `lat`/`lng` + the capability on. The server
fetches and writes `weatherData` with `source: "open-meteo"`.

**A hand-supplied reading.** The API accepts `weatherData` from a caller
**only** with a non-empty `source` and a `recordedAt`, and **only** when that
source is not one of the server's own (`open-meteo`). A bare
`{ "tempMax": 24 }` is refused with a named problem, and no caller can put
`source: "open-meteo"` on a day.

That is the line the whole ticket rests on, and it is a validator rule with a
test rather than a convention: an agent that supplies a reading has to say
where it got it, and the string it supplies is what the page credits. It
cannot borrow the archive's name for something it believes.

**A hand-supplied reading is never overwritten by a lookup.** The fetch only
fills a `weatherData` that is absent.

## When the fetch runs

Two entry points, one function:

- **On write** — `POST .../days` and `PATCH .../days/<slug>`, after the file
  is on disk and before the response. Awaited with a timeout rather than left
  as a floating promise, because a detached promise in a serverless handler is
  a fetch that may simply not happen; every failure is swallowed, so **a dead
  network or a slow archive never fails the write**. The day is saved without
  weather and the script below picks it up.
- **`npm run weather:update`** — the shape `scripts/update-rates.mjs` already
  established. Sweeps every day carrying `weather: true` and no `weatherData`,
  fetches, writes. Idempotent, safe to run on a timer, and the answer to a day
  written offline.

## The capability

`weather` in `FEATURE_NAMES`, `{ env: [], db: false }` — no secret, no
database. Off by default. **Off means no request is made to open-meteo.com on
any path**, and nothing is rendered: not an empty box, not a reserved space.
`/api/health` says why it is off, as it does for every other capability.

## What is shown

A `DayWeather` glyph in the day's meta line in `components/StoryPager.tsx` —
beside the date and the flag, in the day's own furniture, **never inside the
prose**. That placement is the visible half of the labelling: a reader can see
at a glance that the site is speaking and not the author.

Inline SVG, one glyph per WMO group (clear, partly, cloudy, fog, rain, snow,
thunder), animated with CSS keyframes in `app/globals.css` — a drifting cloud,
falling rain strokes, a slow sun. **No JavaScript**: `StoryPager` is already a
client component, and this adds markup to it rather than behaviour, so a trip
page rendering forty days pays for forty small SVGs and no more.
`@media (prefers-reduced-motion: reduce)` sets `animation: none` on all of
them.

The reading beside it is a temperature range and, when there was any,
precipitation. The source is credited in the element's title and, for
Open-Meteo, linked.

## Not doing

Forecasts for an upcoming trip — a different feature, and `plan.md` is where
it would live. Weather on the map. Any use of this data to generate prose.
Per-day units (the journal's `units` setting already exists and metric is what
the provider returns; converting is a later ticket if anybody asks).
