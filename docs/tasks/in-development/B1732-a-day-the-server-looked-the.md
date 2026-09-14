---
id: B1732
title: A day the server looked the weather up for cannot be written back, so a mirrored folder refuses on every correction
type: ISSUE
priority: high
complexity: low
area: api v2, weather
found: "2026-09-14T11:57:12Z"
started: "2026-09-14T11:57:55Z"
session: 3309c078-d934-4ee7-ad04-6cd719fc543a
claimed: "2026-09-14T11:57:55Z"
---

# B1732 — A day the server looked the weather up for cannot be written back, so a mirrored folder refuses on every correction

## Why

Found while checking an auditor's question about Open-Meteo re-lookups not
being deterministic. The answer to that question turned out to be fine; on the
way to it, this fell out.

Reproduced live, against the demo journal, sending back exactly what the
instance had just answered with:

```
$ curl -s .../days/2026-06-03-denver-and-a-truck -o day.json      # 200
$ curl -X PATCH '.../days/2026-06-03-denver-and-a-truck?dryRun=true' \
       -H 'if-match: "2d4dd93e…"' --data @day.json
{"error":"invalid_request","details":[{"field":"weather.source",
  "problem":"this source name is the server's own — a caller may never claim it"}]}
HTTP 400
```

The rule is right and stays: a caller may not claim the server measured
something. But **the server writes that reading itself** (B1713), hands the
document back on every `GET`, and the documented way to correct a day is to
read it, change a field and write it back. So the ordinary read-modify-write
is refused on a value the caller never chose — and since a client's folder is
now a mirror of the instance (B1715), that is every day the server has weather
for: 36 of the demo journal's 44, all 47 of the first real migration's.

It makes `validate-content` report an error on each of those days, and
`publish` fail on any correction to one.

## Work

- Echoing is not claiming: an unchanged `weather` is dropped from a `PATCH`
  body (the merged document keeps what is stored), and a `PUT` — which
  replaces the whole document, so dropping would make it `422 incomplete` —
  validates with `dayMerged`, the shape that already accepts what the server
  itself wrote.
- A CHANGED reading naming a reserved source stays refused, unchanged.

## Acceptance

- A day with a server-fetched reading round-trips: `GET` then `PATCH` of the
  whole document, and `PUT` of it, both succeed.
- A reading altered by one degree and still claiming `open-meteo` is refused.

## Done, 2026-09-14

`stripWeatherEcho` beside `stripMediaEcho`, which has the same job for the
fields the server derives from an upload. The difference, and it is the whole
care of this ticket: this one compares against what is stored, because for
weather "handed back" and "asserted" are not the same fact.

**A bug in my own first version, caught by the existing retry test rather than
by review:** a day whose lookup came back empty keeps `weather: true` stored,
so re-sending `weather: true` deep-equalled it and was stripped as an echo —
which silently swallowed the one way a caller has to ask again (B1713's own
contract). `true` is an instruction, not a value being handed back, and it is
now excluded explicitly in both paths.

Five cases in `test/weather-patch-refetch.test.ts`, including the echo by
`PATCH` and by `PUT`, the altered reading still refused, and the retry still
reaching the archive.
