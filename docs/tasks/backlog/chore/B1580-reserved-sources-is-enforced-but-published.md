---
id: B1580
title: RESERVED_SOURCES is enforced but published only as prose, so a client has to hardcode it
type: CHORE
priority: low
complexity: low
area: lib/weather.ts, contract
found: "2026-09-12T10:12:12Z"
---

# B1580 — RESERVED_SOURCES is enforced but published only as prose, so a client has to hardcode it

## Why

`RESERVED_SOURCES` (`lib/weather.ts:56`) is the list of weather sources only
this server may claim — `open-meteo` today. `lib/validate/entry.ts:758`
refuses a `weatherData.source` naming one, which is the single string holding
up the rule that separates a measurement from an invention.

It is published **only as prose**: `openapi.json` says "`open-meteo` is
refused as a source" in a sentence, and nothing carries it as an enum. So a
client that has to avoid sending one has nothing to read and must hardcode it
— which `fernscout-helper`'s `shared/dayFields.mjs` now does, with a comment
pointing here.

That is not hypothetical tidiness. A day whose weather this server looked up
carries `source: "open-meteo"` **written into the file**, so any client that
forwards a journal's `weatherData` hits the refusal on every such day. B1578
found that by driving and had to hardcode the list to work around it. A second
reserved source added here would break that client silently, in the one place
the project cares most about being right.

AGENTS.md already has the rule this breaks: *an enum is imported, never typed
out* — and the document imports the constant the validator uses.

## Work

Publish it. The cheapest honest home is `/api/health`, which already carries
the limits a caller needs before hitting them, beside the media formats; the
alternative is an `enum` on `weatherData.source`'s schema in
`lib/api/openapi.ts`, which is where a caller building a request is already
looking. Either way the constant is imported rather than re-typed, and
`test/openapi-contract.test.ts` already fails on an enum that has drifted from
its source.

Then `fernscout-helper` reads it and its hardcoded copy goes.

**Related but larger:** B1577 is the same problem for the file-key lists, and
this is one list further down. Worth folding in if B1577 is built first.

## Acceptance

- A caller can read the reserved source names from a published document
  without parsing English.
- Adding a second reserved source in `lib/weather.ts` changes that document
  with no second edit.
- `fernscout-helper` holds no hardcoded copy.
