---
id: B1580
title: RESERVED_SOURCES is enforced but published only as prose, so a client has to hardcode it
type: CHORE
priority: low
complexity: low
area: lib/weather.ts, contract
found: "2026-09-12T10:12:12Z"
started: "2026-09-12T10:25:42Z"
merged: "2026-09-12T10:35:26Z"
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


## Built, 2026-09-12

`/api/health` serves `weather.reservedSources`, imported from `RESERVED_SOURCES`
rather than re-typed, and `lib/api/openapi.ts` describes it — also importing
the constant, so `test/openapi-contract.test.ts`'s drift check applies.

**A deny list, not an `enum` on the field.** Every other source is valid, which
is the opposite of what an enum says; `weatherData.source` is free text on
purpose, because it names whatever actually took the reading and no server can
enumerate that.

**The test that matters is not "it is served".** Each published name is driven
through `validateEntry` and must come back refused, and the lengths must match.
A document naming more than the validator enforces sends a client round a bend
that is not there; naming less is the drift this ticket is about. A third test
checks an ordinary source is *not* refused — the guard-fires-on-an-honest-run
case, which for a free-text field is the likelier failure.

`fernscout-helper` reads it now and its hardcoded copy is gone. The fallback is
not that copy in disguise: an instance too old to publish the list, or one that
could not be reached, falls back to `open-meteo` **and the run says so, once
per run rather than once per day**.

### Evidence

- `curl /api/health` unauthenticated → `{"reservedSources": ["open-meteo"]}`.
- `publish --dry-run` against that instance: four days' readings skipped, zero
  fallback notes — it used the instance's own answer.
- Against a doctored pre-B1580 health document: the run still skips correctly
  and prints the fallback note exactly once.

### Found in passing, captured not absorbed

**B1582** — `health()` and `contentModel()` never create the cache directory;
only `openapi()` does. Deleting it makes `health()` report *"Could not reach
…"* about a server that had just answered, and `publish` then loses its upload
limits **in silence**, falling back to a guessed 64 MB request ceiling. Found
by deleting the cache to force a fresh fetch during this drive, which is the
obvious thing to do.
