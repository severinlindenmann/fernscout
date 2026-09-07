---
id: B538
title: A day the archive has no answer for re-fetches on every PATCH
type: ISSUE
priority: low
complexity: low
area: api, weather
found: "2026-09-06T08:20:00Z"
started: "2026-09-07T10:37:38Z"
merged: "2026-09-07T11:05:29Z"
completed: "2026-09-07T13:11:46Z"
---

# B538 — A day the archive has no answer for re-fetches on every PATCH

## Why

Found reviewing B325's own diff before merging it, not in the field.

`fillDayWeatherQuietly` runs after every successful `POST .../days` and
`PATCH .../days/<slug>` (`app/api/v1/[user]/trips/[trip]/days/route.ts` and
`.../[slug]/route.ts`). It short-circuits before the network on four
conditions, and the one it cannot short-circuit on is **a day that asked, has
coordinates, and got no answer** — a date the archive has no row for, a
coordinate over open water, a provider outage.

That day fetches again on every subsequent PATCH, for as long as the answer
stays missing. An agent correcting a typo in a day's prose ten times makes ten
requests to open-meteo.com. Nothing caches the "no answer", because a "not
yet" that cached would defeat the whole point of coming back for it later.

**It needs a valid write token, so this is a courtesy problem rather than a
security one** — the caller is already authenticated to write to that trip and
could do far worse with the same credential. What it risks is this instance
looking like a bad citizen to a free, keyless public service that every
self-hoster of this software shares.

The sweep (`npm run weather:update`) has the same shape and is fine: it is run
on a timer, not per keystroke.

## Work

Cheapest thing that works, in preference order:

- Record the failed attempt on the day — a `weatherCheckedAt` beside
  `weatherData`, or an entry in a small file — and skip the fetch if the last
  attempt was within a few hours. Adds a field.
- Or: only fetch from `PATCH` when the body actually touched `weather`, `lat`,
  `lng` or `date`. Cheaper, no new field, and it covers the realistic case
  (an agent editing prose repeatedly) while still filling in a day whose
  coordinates just arrived. **Probably the right one** — the sweep is what
  exists for everything else.

Not doing: a rate limiter around the provider. The routes already sit behind
`lib/rateLimit.ts` and a second limiter for one outbound call is a knob nobody
will tune.

## Acceptance

- A `PATCH` that changes only `content` on a day whose weather is already
  recorded, or whose lookup previously came back empty, makes no request to
  the provider.
- A `PATCH` that adds `lat`/`lng` to a day carrying `weather: true` still
  fetches.
- A test that fails before the change: two PATCHes of unrelated fields against
  a day the provider answers nothing for, asserting one fetch and not two.

## Resolution

Took the second option named in Work: `PATCH .../days/<slug>`
(`app/api/v1/[user]/trips/[trip]/days/[slug]/route.ts`) now calls
`fillDayWeatherQuietly` only when the patch's own keys include `weather`,
`lat`, `lng` or `date` — reusing the `keys` array the route already computes
for the `unwritable` check just above, no new field. `POST .../days`
(create) is unchanged: a fresh day's first write is exactly the case that
should always try.

Test: `test/weather-patch-refetch.test.ts`, two tests —
"a PATCH touching only unrelated fields does not re-fetch weather the
provider has already answered nothing for" (creates a day with `weather:
true` and coordinates against a provider that answers nothing, then two
content-only PATCHes; asserts `fetch` called once total, from the create) and
"a PATCH that adds coordinates to a day asking for weather still fetches"
(creates a day with `weather: true` and no coordinates, then PATCHes in
`lat`/`lng`; asserts exactly one fetch, from that PATCH). Both fail against
the pre-fix code (the first would see two extra fetches; verified the fix by
running the file before and after the route change).

`npm run verify` green (see final report).
