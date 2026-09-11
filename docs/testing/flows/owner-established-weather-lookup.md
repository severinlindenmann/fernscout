# Flow: owner-established-weather-lookup

**Persona:** `owner-established` (docs/testing/personas/owner-established.md)
**Interface:** agent (`/api/v1`), plus the `npm run weather:update` batch
route
**Capabilities exercised:** `weather`
**Device/locale:** run once at the requested viewport for the published
day's weather line; the lookup itself has no UI of its own.
**Check type:** technical, and specifically a test of the AGENTS.md rule
that "weather has one true route, and it is not your memory" — an agent may
only ask for the server's own lookup, never supply an answer itself.

## Setup

1. Local dev server running with `features.weather` on — Open-Meteo needs no
   key and nothing is stored anywhere but the day's own frontmatter
   (`lib/capabilities.ts`'s own comment).
2. An owner-scoped agent token, an existing trip, and one existing day with
   coordinates already recorded (this trip's own location, not invented for
   the test — B1090's own point about testing against content that already
   existed).

## Steps

1. As the agent, `PATCH` the day with `weather: true` (or `POST` a new day
   the same way). Confirm the write succeeds and, in the same call chain,
   `fillDayWeather` runs and fills `weatherData` from Open-Meteo, credited to
   the archive — never a value the agent supplied itself.
2. Separately, attempt to `PATCH` the same day with a hand-written
   `weatherData` naming `"open-meteo"` as its `source`. Confirm this is
   refused: AGENTS.md is explicit that "open-meteo is refused there, because
   that name means this server measured it" — an agent may report a reading
   *a person handed it* under any other source name, but never claim the
   server's own archive for words nobody asked the server to fetch.
3. With `features.weather` off, repeat step 1. Confirm `weather: true` is
   refused with `400 weather_disabled` and nothing is written (B778's own
   rule, `lib/api/openapi.ts`'s documented refusal).
4. Run `npm run weather:update` against the same journal. Confirm it fills
   any day that asked (`weather: true`) and has no reading yet, and leaves
   alone both a day that already has one and a day the archive cannot answer
   for (no invented value written in either case).
5. View the published day in a browser. Confirm the weather line renders
   with the archive's own credit line.

## Done when

- `weather: true` is honoured only by an actual Open-Meteo lookup — never by
  anything the request body supplied for the reading itself (technical
  check).
- A request naming `"open-meteo"` as `weatherData.source` by hand is refused
  (technical check — this is the guard, not a prompt, per AGENTS.md's own
  point that "rewording the prompt did not fix any of these, and a code
  guard fixed all of them").
- `features.weather` off refuses the write with `weather_disabled` and
  changes nothing on disk (technical check).
- `npm run weather:update` never overwrites a day that already has a
  reading and never invents one for a day the archive cannot answer
  (technical check, AGENTS.md's own description of the script).
- The published day's weather line renders correctly at the requested
  viewport, with its source credited (graphical check).
