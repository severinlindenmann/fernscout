---
id: B1578
title: Three day fields the instance accepts are never sent, so a timezone, a handed-over weather reading and a day's visibility stay on the laptop
type: ISSUE
priority: medium
complexity: low
area: fernscout-helper, publish, days
found: "2026-09-12T09:15:15Z"
started: "2026-09-12T10:07:11Z"
merged: "2026-09-12T10:19:30Z"
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


## Built, 2026-09-12

`shared/dayFields.mjs` gains the three, so `publish` sends them. Sent, never
composed — each travels only when the file already carries it. The instance
does the format checking and all of it was already there; nothing in
`lib/validate/entry.ts` needed changing.

### The trap this had, found by driving and not by reading

**A day whose weather this server looked up carries `source: "open-meteo"`
written into its own file**, and sending that back is refused — only a server
may claim that name. Every one of `content/example`'s `alps-2024` days carries
one, so the first version of this fix would have failed the run on **every day
the archive has ever answered for**. `publish` now skips a reading with a
reserved source and says so, rather than dropping it quietly; `--weather` asks
the new instance for its own lookup.

The reserved list is hardcoded in the helper because the instance publishes it
only as prose — captured as **B1580**.

### Evidence, driven against a dev server on content/example

- `timezone: "Europe/Zurich"` and `visibility: guest` on a real day reach the
  site and read back over the API.
- A reading sourced *"the Kestrel on my handlebars"* reaches the site whole:
  `{source, recordedAt, tempMin, tempMax, precipitation}`.
- The day carrying the server's own `open-meteo` reading is skipped with a
  named line, and the file on the server is left exactly as it was.
- The refusals the rule rests on, driven directly: `open-meteo` as a source,
  a reading with no source, provenance with no measurement, `tempMax: 900`,
  `recordedAt: "last Tuesday"`, and `visibility: "public"` are each refused
  with the field named.
- `validate-content` reports no drift at all now, and the `perfekt` fixture is
  back to **0 warnings** from 3.

### One refusal that did not happen, and should have

`{"timezone":"+02:00"}` was **accepted** and written, while the refusal it
would have raised says *"an IANA zone name — not an offset"*. `Intl` has since
grown offset time-zone support, so the check no longer does what its own
message promises, and an offset carries no daylight saving. Captured as
**B1579**; not fixed here, because it is the instance's validator rather than
this ticket.

## The rule, updated

The user's decision, and the reason: an agent **may** send these three, so
long as the data is real and the format matches — which is what lets somebody
use their own agent and tools to produce it instead of this service's lookup.

- `AGENTS.md` — "Weather has one true route" became "two true routes", with
  the `weatherData` conditions listed and the prohibition sharpened to what it
  always actually was: inventing the reading. It now also says the part only
  instruction can cover — the server can check that a source was *named*, never
  that it was *real*, so a plausible instrument invented to satisfy the check
  is the same lie with an extra step.
- `lib/api/agentCopy.ts` — the network-facing `/skill/add-a-day.md` copy said
  "a reading they took themselves", which is narrower than the decision. It now
  names an instrument, a station or a weather service, and says plainly that
  the route exists so somebody's own tools can produce their own data. Trimmed
  to stay under the guide's 10 KB ceiling rather than raising it.
- `fernscout-helper/AGENTS.md` — the same, for the agent on that side.
