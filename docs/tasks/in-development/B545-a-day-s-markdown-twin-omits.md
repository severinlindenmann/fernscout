---
id: B545
title: A day's markdown twin omits the weather that is on its page
type: ISSUE
priority: medium
complexity: low
area: api, markdown twin, weather
found: "2026-09-06T09:00:00Z"
started: "2026-09-07T10:37:38Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T10:37:38Z"
---

# B545 — A day's markdown twin omits the weather that is on its page

## Why

Found immediately after B325 shipped, while trying to answer a much simpler
question — *does the live demo have weather yet* — by reading a day's twin.
The twin could not answer it, and that is the bug.

`render()` in `lib/api/markdownTwin.ts:168` projects title, date, time,
location, country, lat, lng, a photo count, `test:` and the translations. It
does not project `weather:` or `weatherData:`. So a published day whose page
shows *"2° – 18°C · 2.9 mm"* credited to Open-Meteo has a twin that says
nothing about weather at all.

That contradicts what the twin is sold as, and B371 is the ticket that made
that promise explicit: it is *"the source that produced the page"*, which is
why a day written in several languages had to start carrying all of them.
Weather is now a second thing on the page that the source-of-the-page does not
mention.

Two concrete costs, neither hypothetical:

- **An agent cannot read back what it wrote.** `weather: true` is accepted on
  `POST` and `PATCH`, and the answer the server fetches is the whole point of
  the field — but `GET /<user>/day/<slug>.md` will not show either. An agent
  that asked for a lookup has no way to see whether one happened.
- **It breaks the migration story B533 built.** `FRONTMATTER_TO_API` now has
  rows for `weather` and `weatherData` telling an agent moving a journal to
  carry them across — including the rule that a reading sourced `open-meteo`
  is refused and should be re-requested as `weather: true`. An agent reading
  the twin instead of the file on disk will not see the fields it is being
  told to carry.

## Work

Add both to `render()`, beside `test:`:

- `weather: true` when the day asked for a lookup.
- `weatherData: { … }` when there is a reading — `weatherLine()` in
  `lib/weather.ts` already renders exactly this, so use it rather than a
  second formatter.

The provenance travels with it or it is not worth adding: a twin showing
`tempMax: 18` with no `source` and no `recordedAt` would be the very shape the
validator refuses on the way in, handed back out as though it were canonical.

Check while you are there whether the twin should say a reading came from the
archive in words as well. It is served as text/markdown to agents rather than
rendered to readers, so CC BY's *"link next to any location the data are
displayed"* is arguably not engaged — but `source: "open-meteo"` inside
`weatherData` names it either way, which is probably enough. Decide it
deliberately rather than by omission.

## Acceptance

- `GET /<user>/day/<slug>.md` on a day carrying weather shows `weather:` and a
  `weatherData:` line whose `source` and `recordedAt` are present.
- A day with no weather shows neither, and no empty line where they would go.
- A test in `test/markdown-twin*.test.ts` covers both, since the promise the
  twin makes is the thing being fixed.

## Resolution

`Entry` (`lib/types.ts`) had no field for "this day asked" as distinct from
"this day has a reading" — `entry.weather` is only ever the parsed
`weatherData` (`parseWeather(data.weatherData)` in `lib/entries.ts`), and a
day that asked but has no answer yet reads exactly like a day that never
asked. Added `weatherAsked?: boolean`, set from `data.weather === true` at
the same spot `entry.weather` is set (`lib/entries.ts`).

`render()` in `lib/api/markdownTwin.ts` now emits `weather: true` when
`entry.weatherAsked`, and a `weatherData:` line via the existing `weatherLine`
helper (`lib/weather.ts`) when `entry.weather` is present — the same
formatter `lib/api/weather.ts` splices into the file on write, so there is
one formatter rather than a second one that could drift from it. Provenance
(`source`, `recordedAt`) is part of `DayWeather` and therefore always present
when the line is.

Decided the "say it in words too" question in Work: left it as `source:
"open-meteo"` inside `weatherData` and nothing more. The twin is served as
`text/markdown` to agents, not rendered to a reader, so CC BY's "link beside
any location the data are displayed" is not engaged here the way it is on the
HTML page (which already credits Open-Meteo in prose).

Test: `test/markdown-twin.test.ts`, three new tests under "the trip-scoped
twin" — a day with a reading shows both lines with provenance, a day that
asked and has no answer shows `weather: true` and no `weatherData`, and a day
that never asked shows neither. All three fail against the pre-fix `render()`
(it has no reference to `entry.weather` or `entry.weatherAsked` at all).

`npm run verify` green (see final report).
