---
id: B1783
title: The one source name a caller may never write is not published anywhere a caller can read it
type: ISSUE
priority: medium
complexity: low
area: app/api/v2, lib/weather.ts
found: "2026-09-15T06:42:48Z"
started: "2026-09-15T06:43:42Z"
session: 135632db-3afb-4bd0-bf02-4ee0fb20ab0d
claimed: "2026-09-15T06:43:42Z"
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
