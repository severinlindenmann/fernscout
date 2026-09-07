---
id: B778
title: Asking for weather on a journal with weather off is accepted and does nothing
type: ISSUE
priority: medium
complexity: low
area: api, weather
found: "2026-09-07T14:23:37Z"
---

# B778 — Asking for weather on a journal with weather off is accepted and does nothing

## Why

`PATCH /api/v1/<user>/days/<slug> {"weather": true}` on a journal whose
`weather` capability is **off** answers `200 {"changed":["weather"]}` — and
nothing happens. `fillDayWeather()` is deliberately fire-and-forget and silent,
which is right for the nightly sweep and wrong for a synchronous answer to a
caller who just asked for something.

Re-reading the day afterwards shows no `weatherData` and no pending marker, so
the only way an agent can discover that its request did nothing is to diff a
re-read and guess why.

AGENTS.md is explicit that "it was accepted" must not be a different claim from
"it is there". This is that, in the one place a capability is off rather than
broken.

Found live on 2026-09-07.

## Work

Answer honestly. Either refuse the field when the capability is off, naming it
the way `/api/health` does, or accept it and say in the response that no lookup
will happen and why. Refusing is probably right: `weather: true` is a request
for a measurement, and a request nobody will service is better declined.

## Acceptance

A caller asking for weather on a journal with weather off is told so in the
response to that call.
