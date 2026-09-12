---
id: B1578
title: Three day fields the instance accepts are never sent, so a timezone, a handed-over weather reading and a day's visibility stay on the laptop
type: ISSUE
priority: medium
complexity: low
area: fernscout-helper, publish, days
found: "2026-09-12T09:15:15Z"
---

# B1578 — Three day fields the instance accepts are never sent, so a timezone, a handed-over weather reading and a day's visibility stay on the laptop

## Why

**Found by the guard B1569 built, on its first run against a real journal** —
which is the guard working, and the reason it exists.

`EDITABLE_DAY_FIELDS` (`lib/api/entries.ts:980`) names what
`PATCH …/days/{slug}` accepts. Three of them have never been in the list
`publish.mjs` sends, so a day carrying one validates cleanly, publishes
cleanly, and leaves the value on the laptop:

| key | what is lost |
| --- | --- |
| `timezone` | the day's own zone — what a reader's "their time" is computed against |
| `weatherData` | a reading **a person handed over**, with its source named. The one weather a file is allowed to carry (`open-meteo` is refused there, because that name means the server measured it) — and it never arrives |
| `visibility` | the day's own visibility |

`weatherData` is the one worth reading twice. AGENTS.md's rule is that an agent
never writes weather from its own belief, and that a reading somebody handed
you goes in `weatherData` and must name its source. That is the sanctioned
route for a measurement nobody can look up — and the only client that writes
journals from a folder drops it in silence. A person who typed a reading off
their own barometer into a day got a run that said it worked.

## Work

Add the three to `DAY_UPDATE_DOORS` in `shared/dayFields.mjs` — which is the
whole fix, since `publish.mjs` sends that list now (B1569) — and check each
against the request schema first rather than assuming the file spelling and
the API spelling agree. `weatherData` has a shape of its own in
`openapi.json`, and its `source` is refused when it names `open-meteo`; a day
whose `weatherData` the instance rejects should stop the run the way any other
refusal does rather than be dropped again.

The guard that found this then goes quiet by itself — no change to
`validate.mjs`.

## Acceptance

- A day carrying `timezone`, `weatherData` or `visibility` reaches the site
  with that value, proved by reading the day back over the API.
- `validate-content` no longer warns that any of the three is never sent.
- A `weatherData` the instance refuses stops the run and prints the refusal,
  rather than being dropped in silence.
