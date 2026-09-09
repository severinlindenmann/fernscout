---
id: B1090
title: A day's zone must be worked out from where it happened, or B42 helps almost no day that exists
type: ISSUE
priority: high
complexity: medium
area: entries, feed, i18n
found: "2026-09-09T15:51:35Z"
started: "2026-09-09T15:52:03Z"
session: eef381a2-5a19-477a-a5ce-5f4f2d3dacab
claimed: "2026-09-09T15:52:03Z"
---

# B1090 — A day's zone must be worked out from where it happened, or B42 helps almost no day that exists

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

B42 shipped this morning and is very nearly inert. It gave an entry an
optional `timezone:` field and taught the feed and the day page to read it —
but nothing works out that field for a day that does not already carry one,
and **no day that exists carries one**. The two exceptions are the two demo
days B42 itself edited.

Caught by the owner within the hour, on a real page:

    https://fernscout.ch/example/trips/asia-2023/day/bangkok-first-morning

`09:15`, in Bangkok, and a reader in Zurich sees `09:15` and nothing else. The
day has `lat: 13.7563, lng: 100.5018` sitting right there in its own
frontmatter.

The feed half is worse, because it looks fixed and is not. With no `timezone:`
the RSS `pubDate` falls back to the journal's own zone, so that Bangkok
morning is now read as though the clock were Zurich's:

| | `pubDate` |
| --- | --- |
| The truth (Asia/Bangkok, +7) | `02:15 GMT` |
| Before B42 (a literal `Z`) | `09:15 GMT` |
| After B42 (falls back to Europe/Zurich, +1) | `08:15 GMT` |

Six hours out instead of six and a quarter. For every day that has a `time:`
and no `timezone:` — which is every day in every journal — B42 changed the
size of the error and not the fact of it.

**The scope decision that caused this was mine and it was wrong.** B42's own
Work section asked for the zone to be resolved from `lat`/`lng` at write time.
I dropped that half to avoid a dependency and shipped the field alone, on the
reasoning that the writer already knows the zone. The writer does — and every
day already written does not, which is the case that matters.

## Work

Resolve the zone from the coordinates the day already carries.

- Add **`tz-lookup`**: 152 KB, CC0-1.0, no dependencies of its own. It is a
  coarse raster rather than exact boundary polygons, so a coordinate within a
  kilometre or so of a zone border can land on the wrong side. That is
  acceptable here and worth writing down: a day's coordinate is a town, the
  field stays explicit and hand-correctable, and the alternative with real
  polygons (`geo-tz`) is 73 MB. It is refused only where it must be — see
  below.
- **At write time**, in the day-create and day-edit paths: when a day has
  `lat`/`lng` and no `timezone:`, resolve one and write it into the
  frontmatter. An explicit `timezone:` in the request always wins and is never
  overwritten.
- **Backfill what exists**, as its own script, the way `npm run weather:update`
  already works: fill in every day that has coordinates and no zone, never
  overwrite one already there, and leave a day whose coordinates resolve to
  nothing for a person rather than guessing. This is the half that makes the
  feature real, since it is the existing days that are wrong today.
- The resolver belongs in `lib/timezone.ts` beside the arithmetic B42 added.

**A day with no coordinates gets no zone**, and keeps today's behaviour
exactly: the bare local time on the page, the journal's zone in the feed. Do
not guess one from `location:` or `countryCode:` — a country is not a zone,
and the whole point of AGENTS.md's rule about inventing a day applies to
inventing where it was.

Not doing: re-deriving the zone for a day that already names one, and not
touching `weatherData`, which is measured at the same coordinates and has its
own route.

## Acceptance

- `https://fernscout.ch/example/trips/asia-2023/day/bangkok-first-morning`
  shows the reader's own time beside `09:15` for a reader outside Asia/Bangkok,
  and that day's `pubDate` reads `02:15 GMT`.
- A new day written through the API with `lat`/`lng` and no `timezone:` comes
  back from a documented `GET` carrying one.
- A day with no coordinates is unchanged, and a test says so.
- The backfill is idempotent: running it twice changes nothing the second time.

