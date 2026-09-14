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

---

## Revalidated, 2026-09-14 — valid, and worse than written

Confirmed: `app/api/v2/[user]/trips/[trip]/days/[slug]/route.ts` called
`weatherLookupRefused` on both write paths and nothing else, and
`fillDayWeatherQuietly` had no caller under `app/api/v2/` at all.
`test/weather-patch-refetch.test.ts` had already noticed and pinned the
behaviour as "the actual, current, honest behaviour", explicitly leaving
"whether that is the intended shape of v2" to a person. This ticket is that
person's answer.

**A second defect underneath it, found by the first test that asked for a
lookup through a v2 slug.** `fillDayWeather` finds a day's file with
`entrySlugFromFile(f) === slug`, which strips the date — so it matches
`hoi-an` and never `2026-08-26-hoi-an`, which is exactly what a v2 route's
slug is. Every v2-slugged day answered `unwritable`. Wiring the call in
without this would have changed nothing at all: the fetch would have been
skipped before it ever reached the network, silently, which is the same
failure one layer deeper. It matches either spelling now.

**And a third, which the fix made reachable.** A `PATCH` re-validates the
merged document with `dayWrite`, whose `weather` refuses
`source: "open-meteo"` — a caller may never claim the server's own source.
Once the server itself starts writing that reading, the stored half of every
later merge carries it, so correcting a typo on a day the server had looked up
answered `400 weather.source`. `dayMerged` (lib/api/v2/schemas/day.ts) is
`dayWrite` with the *read* reading allowed and nothing else changed; the rule
itself is untouched, because it is enforced where a caller's own bytes are
(`dayWrite` on create, `dayPatch` on correction). The publish route's
completeness check had the same flaw with a quieter symptom — the parse failed
for a reason that is not incompleteness, `incompleteFrom` found nothing
missing, and the gate passed every such day — and now uses `dayMerged` too.

## Done, 2026-09-14

- `serviceWeather` in the day route, called by `PUT` and `PATCH` after the
  write, awaited, failure swallowed, and the echo built from the day as it
  stands afterwards — so the reading is in the response to the call that asked
  for it.
- **Only when the caller asked in that call**: the `PUT` passes the body's
  `weather`, the `PATCH` passes the *patch's*, never the merged document's.
  That is B538's property, which until now had no v2 counterpart: a day whose
  lookup came back empty keeps `weather: true`, and reading the merged
  document would have re-fetched on every later correction of a typo.
- The sweep is gone: `scripts/weather-update.mts` deleted, the `weather:update`
  script removed from `package.json`, and step 0c of `scripts/backup.sh`
  replaced by a comment saying what used to be there and why it is not.
- The prose that described the sweep as the mechanism: `lib/api/weather.ts`,
  `lib/api/v2/days.ts`'s refusal, `ERROR_CODES.weather_disabled`,
  `docs/agents/content-model.md`, the testing flow, and the incidental
  references in `lib/entries.ts`, `scripts/rates-fill.mts` and
  `scripts/timezone-update.mts`.
- **What happens when the archive has no answer is now published**, in
  `lib/api/skillDocs.ts` — the day comes back with `weather: true` and no
  reading, that is "not yet" rather than a failure, nothing comes back for it,
  and sending `weather: true` again is how to ask a second time.
- `lib/api/weather` added to `LIB_API_ALLOWLIST` in
  `test/api-v2-imports.test.ts`: a lookup that writes a file is a domain
  function by that rule's own test (no `Request` read, no `Response` built),
  and `lib/api/v2/days.ts` had already said so in prose.

`test/weather-patch-refetch.test.ts` is rewritten around the new contract:
a `PUT` that asks fetches once and answers with the reading; three later
corrections fetch nothing; asking again fetches again; declining never
fetches. `npm run verify` — all 5 passed.

**Not verified yet, and it is an acceptance line:** the live round trip
against fernscout.ch. That needs the deploy.
