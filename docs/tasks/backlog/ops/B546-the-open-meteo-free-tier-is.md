---
id: B546
title: The Open-Meteo free tier is non-commercial and this instance takes money
type: OPS
priority: medium
complexity: low
area: licensing, weather, credits
found: "2026-09-06T09:05:00Z"
---

# B546 — The Open-Meteo free tier is non-commercial and this instance takes money

## Why

Raised with the owner when B325 was switched on for fernchscout.ch's demo
journal on 2026-09-06, and deliberately deferred by them: *"fine for the
moment, add a backlog ticket about it for future."* This is that ticket. **It
is not blocking anything today** — it is a thing to settle before the answer
matters.

Open-Meteo's free API is licensed for **non-commercial use**, under 10 000
calls a day, 5 000 an hour and 600 a minute. The data itself is CC BY 4.0 and
the attribution is done (`site/legal/*.md`, and a link beside every reading —
see B325 and `test/weather-attribution.test.tsx`). The open question is only
the commercial one.

This instance is a hobby project and says so in its own imprint. It also has
`credits` enabled, and `lib/credits.ts` debits a balance when a postcard or a
photobook is sent — real money, on the operator's card. That is enough of a
grey area to be worth a decision rather than an assumption, and the honest
reading is not obvious either way:

- **Arguing it is non-commercial:** the weather lookup is free, is not sold,
  is not part of any paid feature, and does not appear in anything a person
  pays for. Nobody is charged for weather, and removing it would not change a
  single price.
- **Arguing it is not:** the instance as a whole takes payment, and the
  licence is about the *use*, not about which feature the money came from.

Nothing here is urgent — one journal writing a day at a time is nowhere near
10 000 calls, and the demo's whole backfill was about 40. It becomes real if
this instance ever grows past a hobby, or if signup opens and other people's
journals start asking for lookups too.

## Work

Pick one, in increasing order of effort:

1. **Ask them.** Open-Meteo has a contact address and a commercial tier. A
   one-paragraph email describing this instance is probably the whole ticket,
   and their answer is the record. Do this first.
2. **Buy the commercial plan** if that is their answer — it is a dedicated
   endpoint and an API key, which means `OPEN_METEO_*_URL` and a new
   credential in the environment. `lib/capabilities.ts` would gain an env
   requirement for the key, which is the ordinary shape here.
3. **Self-host it.** Open-Meteo's server is AGPLv3 and runs from a Docker
   image against AWS Open Data, with no rate limit and no licence question at
   all. `OPEN_METEO_ARCHIVE_URL` and `OPEN_METEO_FORECAST_URL` are already
   environment overrides — see `lib/weatherFetch.ts` — so this is a config
   change and a container, not a code change. It is the most work and the
   least dependency.

Whichever it is, record the answer in
`docs/plans/2026-09-06-day-weather.md` beside the licence section, which
already names the question.

## Acceptance

- A written answer exists — a reply from Open-Meteo, a purchased plan, or a
  self-hosted endpoint — and the plan document names it.
- If the answer changed anything operationally, `/api/health` and the runbook
  say so.
