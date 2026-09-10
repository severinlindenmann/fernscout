---
id: B1403
title: "Nothing an outside agent reads says weatherData is written by the server, so a filled block reads as fabricated"
type: DOCS
priority: medium
complexity: low
area: content model, agent guide, weather
found: "2026-09-10T21:26:00Z"
---

# B1403 — Nothing an outside agent reads says weatherData is written by the server, so a filled block reads as fabricated

## Why

An agent auditing a journal from the `fernscout-helper` side reported, as a
moderate finding, that *"several entries already had a fabricated-looking
`weatherData` block with no documented way it could have gotten there, against
the repo's own one-way-content rule."*

**They are not fabricated.** Checked against the journal:

```yaml
weatherData: { tempMin: 5.8, tempMax: 10, code: 51, precipitation: 1,
               windMax: 9.5, source: "open-meteo", recordedAt: "2026-09-06T19:14:14.232Z" }
```

`source: "open-meteo"` and a `recordedAt` instant are the signature of the
server's own lookup — the one true route in `AGENTS.md`: a day carries
`weather: true`, the server reads the public archive at that day's
coordinates, and `npm run weather:update` fills in every day that asked. The
whole block, `recordedAt` included, is written by this codebase. The
timestamps across the journal cluster on one afternoon, which is a backfill run
and not a person typing.

So the finding is a false positive — and it is the right instinct producing it.
An agent that has read *"no weather nobody mentioned"* and *"`open-meteo` is
refused as a source when a person hands you a reading"* sees a day carrying
exactly that source and concludes the rule was broken. The rule as written is
about what an **agent** may write; nothing an outside agent reads says the
**server** writes this field, or how to tell its output apart from an
invention.

The cost is not this one report. It is that the next audit reaches the same
conclusion, and that a well-behaved agent may "correct" a genuine measurement
back out of somebody's day.

## Work

Say it where an outside agent actually reads:

- **`/agent.md`** — `weatherData` is filled by the server from the archive when
  a day asks with `weather: true`, and `source: "open-meteo"` with a
  `recordedAt` is what the server's own writing looks like. An agent neither
  writes nor removes it. This is the same paragraph that already refuses
  `open-meteo` from an agent, and it needs the other half.
- **`/content-model.json`** (`lib/contentModel/document.ts`) — check what the
  entry block says about `weather` and `weatherData` today, and whether the
  field is described at all. It is the document the validator checks against,
  so a `because` here is what the client can quote back.
- Check whether the API can read the pair back — `AGENTS.md`'s rule that a
  field the API takes must be readable somewhere applies, and an agent that
  cannot see whether a lookup landed will ask for it twice.

**Not in this ticket.** No change to `lib/weather.ts`, to the script, or to
what an agent may write. This is words.

**Related:** the same audit's fifth finding — a stale `teaser` caught by the
live schema fetch — is the positive control and needs nothing; the gap it
implies for `teaser` itself is B1389.

## Acceptance

- `/agent.md` states who writes `weatherData` and what its server-written form
  looks like.
- Handed only the published documents, an agent auditing a journal with filled
  weather blocks does not report them as invented. Worth checking literally, by
  pointing a fresh `fernscout-helper` clone's validator at this journal after
  the change.
- `npm run verify` clean; `keep-the-contract` if the entry schema moved.
