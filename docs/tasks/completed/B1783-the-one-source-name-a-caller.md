---
id: B1783
title: The one source name a caller may never write is not published anywhere a caller can read it
type: ISSUE
priority: medium
complexity: low
area: app/api/v2, lib/weather.ts
found: "2026-09-15T06:42:48Z"
started: "2026-09-15T06:43:42Z"
merged: "2026-09-15T07:09:18Z"
completed: "2026-09-15T08:19:32Z"
---

# B1783 — The one source name a caller may never write is not published anywhere a caller can read it

## Why

B1580 published the reserved weather source names so a client would not have to
hardcode them — `app/api/health/route.ts:430` serves
`weather.reservedSources`, imported from `RESERVED_SOURCES`, with
`test/health-disclosure.test.ts` driving each published name through the
validator.

It is not in the v2 contract. `/api/v2/status` is what a v2 client reads before
it writes — capabilities, limits, what things cost — and `instanceStatus`
(`lib/api/v2/schemas/status.ts:15`) says nothing about weather. A client built
only against v2 therefore has to either call the older operator door or
hardcode the name, which is what B1580 set out to end. B1782 is the client
finding this out by being refused.

## Work

Add the reserved source names to `instanceStatus`, imported from
`RESERVED_SOURCES` the same way `/api/health` imports it, so one edit to the
constant changes both. A limit belongs where a caller can read it before they
hit it.

## Acceptance

`GET /api/v2/status` publishes the reserved source names; adding a second name
to `RESERVED_SOURCES` changes that answer with no second edit; the v2 schema
test asserts the published list and the validator's own list are the same
length.

## Built, 2026-09-15 — fernscout `48fba671`

**Valid when taken**: `/api/health:430` publishes `weather.reservedSources`
(B1580) and `instanceStatus` said nothing about weather.

`instanceStatus` carries `weather.reservedSources`, imported from
`RESERVED_SOURCES` so one edit to the constant changes both doors. Required
rather than optional: a client that has to cope with its absence is a client
that hardcodes the name instead. `/api/v2/openapi.json` is generated from the
schema, so the contract follows with no second edit.

Keepers: two tests in `test/api-v2-status.test.ts` — the published list equals
the constant, and every name it publishes is actually refused by `dayWrite`
while somebody's own instrument is not. That is B1580's own argument: a
document naming more than the write path enforces sends a client round a bend
that is not there.
