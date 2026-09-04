---
id: B356
title: Reading a day back omits its translations, so an agent cannot verify the ones it wrote
type: ISSUE
priority: medium
complexity: low
area: api
found: "2026-09-04T19:57:27Z"
started: "2026-09-04T21:05:03Z"
session: 62683d95-33a6-4db0-a254-7a8fcbcf014e
claimed: "2026-09-04T21:05:03Z"
---

# B356 — Reading a day back omits its translations, so an agent cannot verify the ones it wrote

## Why

`GET /api/v1/<user>/trips/<trip>/days/<slug>` returns every field a day carries
— title, date, time, location, lat, lng, gallery, tags, costs, transport, test,
content, status — and not `translations`.

On a journal declaring two or more `locales`, a day is *refused* unless it
carries every one of them (B294). So the guide requires the agent to write
translations, and then gives it no way to read back what it wrote. The one
instruction the guide repeats — read the day back and check it stuck — cannot
be followed for the half of the day the reader in the other language sees.

Observed 2026-09-04 on fernscout.ch: a day POSTed with a `de` translation came
back with no `translations` key. The German was on disk and correct; the API
simply does not report it. The `test` flag, by contrast, is deliberately echoed
on every read for exactly this reason — "check it stuck".

## Work

Include `translations` in the day read-back, the same shape it is written in.
The days *list* does not need them; the single-day read does.

## Acceptance

POST a day with a `translations` block to a journal with two locales, GET it
back, and the German is in the response.
