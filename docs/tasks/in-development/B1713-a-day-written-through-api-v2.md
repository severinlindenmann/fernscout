---
id: B1713
title: A day written through /api/v2 gets no weather until the next night, and the owner never knew a nightly sweep was what filled it
type: ISSUE
priority: high
complexity: medium
area: weather, api v2, ops
found: "2026-09-14T09:22:31Z"
started: "2026-09-14T10:11:00Z"
session: 3309c078-d934-4ee7-ad04-6cd719fc543a
claimed: "2026-09-14T10:11:00Z"
---

# B1713 — A day written through /api/v2 gets no weather until the next night, and the owner never knew a nightly sweep was what filled it

## Why

A migration of four real trips into `fernscout.ch/severin` on 2026-09-14 wrote
51 days through `/api/v2`. 47 of them carried `weather: true` and coordinates;
every one of them read back as a bare `true` with no reading, hours later. The
agent doing it concluded nothing on the instance services the field at all and
wrote that up as a bug against the contract.

That conclusion was wrong, and the two reasons it was wrong are each a defect.

**1. The v2 write routes do not look weather up.**
`app/api/v2/[user]/trips/[trip]/days/[slug]/route.ts` calls
`weatherLookupRefused` on both `PUT` (line 155) and `PATCH` (line 278) — it
*refuses* `weather: true` when the capability is off, and does nothing when it
is on. `fillDayWeatherQuietly` is imported by `app/api/helper/[user]/day` and
`app/api/helper/[user]/assemble-day` and by nothing else. So a day written
through the guided helper gets its weather inside the request, and the same day
written through the documented API gets nothing.

`lib/api/weather.ts:12-19` still states the opposite as the point of the
module:

> Two callers and one function, which is the whole point: `POST .../days` and
> `PATCH .../days/<slug>` call it after a write, and `npm run weather:update`
> calls it in a sweep. A lookup that happened one way and not the other would
> be a day whose weather depended on how it was written.

That is exactly what the day now is. The v1 routes those two sentences name
were deleted and their v2 replacements did not carry the call across.

**2. The nightly sweep is real, works, and nobody told the owner it exists.**
`scripts/backup.sh:489-498` runs `npm run weather:update` off
`fernscout-backup.timer` (B1288), nightly at about 03:30 CEST. Verified on the
box: a dry run against the migrated journal answered `would_fetch 47`, and the
real run filled all 47 in one second. The days had simply been written *after*
the last sweep, and the next one would have filled them.

The owner did not know the job existed. That is the defect in it: a field whose
whole promise is "the server looks this up" is serviced by an invisible job on
a timer, so a caller waiting for an answer has no way to tell "deferred to
tonight" from "silently failed". The evidence the migrating agent reached for
instead — `content/example`'s readings all bearing timestamps inside one
two-second window — argued *against* a sweep, and is an artefact of `ship.sh`
rsyncing the demo journal out of the repository on every deploy.

**Owner's decision, 2026-09-14:** get rid of the nightly sweep; fetch the
weather when the day is written.

## Work

- Call `fillDayWeatherQuietly` from the v2 day `PUT` and `PATCH` handlers,
  after the write, awaited — the shape `app/api/helper/[user]/day/route.ts:229`
  already uses. A failed lookup must not fail the write.
- Retire the nightly job: the `weather:update` step in `scripts/backup.sh`,
  the `weather:update` script in `package.json`, and `scripts/weather-update.mts`.
  Keep `fillDayWeather` itself — it is the shared lookup, and the routes are
  its callers now.
- Sweep the prose that describes the sweep as the mechanism: the module comment
  above, `AGENTS.md` / `docs/agents/content-model.md`, the skill docs and the
  `weather_disabled` refusal string in `lib/api/v2/days.ts:248`, which tells a
  caller "no lookup would happen, now or in the nightly sweep". After this
  there is no nightly sweep to name.
- **Say what happens when the lookup comes back empty**, because with the sweep
  gone there is no second attempt. Open-Meteo's archive is reanalysis and lags
  real time, so a day written the evening it happened can legitimately get
  nothing — `fillDayWeather` returns `no_answer` and the day keeps `weather:
  true` forever. Two honest answers, and this ticket does not decide between
  them: either the write response says the lookup returned nothing yet and a
  later `PATCH` re-asks (a `PATCH` already re-runs the fill, so re-sending
  `weather: true` is the retry), or the field is answered on publish as well.
  Whichever is chosen has to be written into the contract, not left implied.
- Not doing: changing what `weather: true` means, or letting a caller supply
  `source: "open-meteo"`. Both rules stand.

## Acceptance

- `PUT /api/v2/{user}/trips/{trip}/days/{slug}` with `weather: true` and
  coordinates answers with the day carrying a reading, in the same response —
  driven against the live instance, not only a test.
- The same for a `PATCH` that adds `weather: true` to an existing day.
- `grep -rn "weather:update" scripts package.json` finds nothing, and
  `systemctl list-timers` shows the backup timer doing one job fewer.
- No published string — contract, skill doc or error message — names a nightly
  weather sweep.
- A day whose lookup returns nothing is described somewhere a caller reads,
  with the way to ask again.
