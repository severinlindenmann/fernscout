---
id: B597
title: A day that declined photographs or coordinates cannot be published a second time
type: ISSUE
priority: high
complexity: low
area: api, days, fernscout-helper, publish
found: "2026-09-06T14:35:01Z"
---

# B597 — A day that declined photographs or coordinates cannot be published a second time

## Why

Found on 2026-09-06 by two agents independently, working on unrelated tickets
(B573 and B578), and then reproduced against the live instance.

`POST .../days` accepts `photos` and `coordinates` — `false` for *this day has
none*, `"unknown"` for *there were some and they are gone*. `PATCH
.../days/<slug>` does not accept either. Its own refusal lists what it takes:

    $ curl -X PATCH .../days/drinks -d '{"photos": false}'
    400 unsupported_field
    This call changes "photos" for nobody, and nothing was written. …
    This endpoint writes title, date, time, location, country, countryCode,
    lat, lng, content, tags, costs, transportMode, transportFrom, transportTo,
    travelScene, test, translations, captions, weather, weatherData.

`costs` is on that list; `photos` and `coordinates` are not. The same call with
`{"costs": "unknown"}` returns 200 and `changed: ["costs"]`.

That asymmetry breaks a re-publish. `publish.mjs` turns a day's `without:` and
`unrecorded:` lines into those fields on **every** write:

    for (const track of entry.data.without ?? [])    body[track] = false;
    for (const track of entry.data.unrecorded ?? []) body[track] = "unknown";

The first publish is a POST and succeeds. The second is a PATCH, because the
day now exists — and any day carrying `without: [photos]` or `without:
[coordinates]` gets a 400. `publish.mjs` stops at the first refusal, so the run
ends there and every day after it goes unwritten.

**A day cannot answer the question twice**: on create it says "no
photographs", and from then on there is no way to say it again, so the file on
disk and the day on the site can no longer be reconciled by re-sending. That is
the same shape as B245 and B572, on a field a person legitimately edits.

This is not hypothetical: the repository's own `halbfertig` fixture has two
days carrying `without: [photos]`. Publishing it twice would fail.

Why it did not surface earlier: the journal it was found on uses
`unrecorded: [costs]`, and `costs` happens to be the one of the three that
PATCH accepts.

## Work

- Decide which side is wrong, and say so in this task before changing
  anything. Two defensible answers:
  - **The route should accept them.** `costs` already is accepted on PATCH,
    and the three are presented to a writer as one idea (`without:` takes any
    of them). The asymmetry looks like an oversight rather than a decision.
  - **The client should only send them on create.** If refusing them on an
    existing day is deliberate — because "this day has no photographs" is a
    statement about a day being written, not a thing to toggle later — then
    `publish.mjs` must stop sending them on PATCH, and the refusal message
    should say *why* rather than only listing what it takes.
- Whichever way it goes, `publish.mjs` must not stop a whole run on it.
- The `Draft`/`DayEdit` schemas in `openapi.json` should differ where the
  routes differ, so a client can tell without a 400.

## Acceptance

- A journal with a day carrying `without: [photos]` publishes twice in a row,
  the second run succeeding and every later day still written.
- The `halbfertig` fixture, published twice against a test instance, comes
  through — it is the case this was found on.
- If the decision is that PATCH keeps refusing them, its message says why, and
  `openapi.json` shows `photos`/`coordinates` on `Draft` and not on `DayEdit`.
