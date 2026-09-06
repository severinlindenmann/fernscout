---
id: B573
title: A journal written by the helper tools can never carry weather
type: FEATURE
priority: medium
complexity: low
area: fernscout-helper, weather, validate-content, publish
found: "2026-09-06T13:45:30Z"
started: "2026-09-06T14:18:14Z"
merged: "2026-09-06T14:34:24Z"
---

# B573 — A journal written by the helper tools can never carry weather

## Why

Asked by an owner on 2026-09-06, after publishing a ten-day trip: *"why is
there no weather? did we not know about the weather option?"* They did not,
and could not have — nothing in `fernscout-helper` mentions it.

The capability is on and the data is there. `GET /api/health` on fernscout.ch
reports `"weather": {"enabled": true}`. `POST …/days` takes `weather: true`,
which asks the server to look the day up in the Open-Meteo archive from its
`lat`/`lng` and `date`. All fourteen days of the trip carry coordinates. The
prose is *about* the weather — "windig und eher kalt", "kalt und windig" —
so it is exactly the trip the field is for.

Two halves, both in `fernscout-helper`:

**`validate-content` cannot mention it.** `validate.mjs:126` is
`if (local.apiOnly) continue;` inside the tip loop, so every key marked
`apiOnly` in `shared/model.mjs` is skipped. `weather` and `weatherData` are
both `apiOnly` (`model.mjs:141-144`), so neither can ever appear. The skill's
own description promises to answer *"what else can I set"*, and this is a
whole class of answer it structurally cannot give. The run against this
journal printed 68 tips and not one of them was weather.

**`publish` could not send it if a file did carry it.** The key list at
`publish.mjs:304-305` is `time, location, country, countryCode, lat, lng,
tags, costs, transportMode, transportFrom, transportTo, travelScene, test,
translations`. No `weather`, no `weatherData`.

The skip is not itself wrong — `apiOnly` keys are request-only and a file that
carried `coordinates:` or `idempotency_key:` would be describing a call rather
than a day. `weather` is the one that is a genuine offer to the owner rather
than a mechanism, and it is being filtered out with the plumbing.

Note the asymmetry the fix must keep. `weather: true` asks the server to
retrieve a measurement; `weatherData` is a reading somebody actually took, is
refused without `source` and `recordedAt`, and refuses `open-meteo` as a
source. **Neither may be written from an agent's own knowledge**, and a day
with no coordinates gets nothing rather than a guess — the repository's one
rule, in the API's own words.

Related: B538 (a day the archive has no answer for yet), B546 (the Open-Meteo
free tier).

## Work

- In `shared/model.mjs`, let a key be request-only *and* offerable. A flag
  beside `apiOnly` — the point is that the validator may tip it while the file
  format still refuses to carry it. Mark `weather` with it; leave
  `weatherData`, `coordinates`, `photos` and `idempotency_key` as they are.
- In `validate-content/validate.mjs`, tip that class. The wording is the whole
  deliverable: it is an *offer to look the weather up*, not a field to fill in,
  and the tip should say the day needs coordinates and that the answer comes
  from the archive rather than from anybody's memory.
- In `publish/publish.mjs`, send `weather` when a day carries it. It is a
  boolean instruction, so it does not belong in `entries/*.md` the way
  `location:` does — decide where a person says yes. The likely shape is a
  trip-level or run-level opt-in (`--weather`), which also matches how the
  owner asked the question: about the trip, not fourteen times.
- Whatever the shape, `AGENTS.md`'s table and the two `SKILL.md` files have to
  name it, since the finding here is that nobody could discover it.

Not doing: `weatherData`. An agent must not write one, and an owner who has a
real reading is a rarer case that can wait for its own task.

## Acceptance

- `validate-content` on a journal whose days have coordinates prints a tip
  offering the weather lookup, and does not print it for a day without
  `lat`/`lng`.
- A day published with the opt-in comes back from `GET …/days/<slug>` carrying
  the archive's reading; the same day without it comes back with none.
- `selftest.mjs` still passes — the fixture journal with every option set gains
  whatever the new key is.
- `AGENTS.md` names weather among what these tools can put into a journal.
