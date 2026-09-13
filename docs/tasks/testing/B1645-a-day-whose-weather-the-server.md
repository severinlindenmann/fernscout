---
id: B1645
title: A day whose weather the server fetched cannot be read back — dayDoc reuses the write shape's reserved-source refusal
type: ISSUE
priority: high
complexity: low
area: API v2
found: "2026-09-13T06:35:37Z"
merged: "2026-09-13T08:01:19Z"
---

# B1645 — A day whose weather the server fetched cannot be read back — dayDoc reuses the write shape's reserved-source refusal

## Why

`dayDoc` (lib/api/v2/schemas/day.ts) spreads `dayBase.def.shape` and then
re-declares `weather` as `z.union([z.literal(true), weatherData])` — the
**same** `weatherData` the write shape uses, whose `source` refines against
`RESERVED_SOURCES` and refuses `"open-meteo"`.

`open-meteo` is exactly what the server writes when a day asked for a lookup
(`weather: true` → `npm run weather:update` fills in the reading). So the
normal, server-authored case is refused **on read**: every `GET` of such a
day goes through `dayDoc.parse(dayEchoInput(day))` (the single-day route and
the day-list route both), and throws.

The schema's own comment says the opposite is intended — *"'open-meteo'
means the server looked it up … the write shape enforces that by refusing
the reserved source"* — so this is the code failing to match a promise the
contract already makes, not a decision to revisit. The refusal belongs to
the write shape alone; a read has to be able to carry what the server itself
wrote.

Found by `test/example-content.test.ts` (B1643) the first time the demo
journal was validated against the schemas: 36 of `content/example`'s 44 days
carry `source: "open-meteo"`.

## Work

- Split the measurement object once: the fields and ranges shared, with two
  variants — the write one refusing `RESERVED_SOURCES`, the read one not.
  `dayBase`/`dayWrite` keep the refusing variant; `dayDoc` takes the other.
- Record the delta row (the frozen folder changes), citing this ticket.
- A test that a day with `source: "open-meteo"` reads back and is refused on
  write, in the same test, so the asymmetry is visible in one place.

## Acceptance

- `dayDoc.parse` accepts a day whose weather carries `source: "open-meteo"`.
- `dayWrite.parse` still refuses one.
- `GET /api/v2/{user}/trips/{trip}/days/{slug}` answers for a day with
  server-fetched weather.

## Work

TODO

## Acceptance

TODO
