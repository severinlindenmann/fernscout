---
id: B1668
title: Trip 422 tells a caller to declined.teaser, a key the schema refuses
type: ISSUE
priority: high
complexity: low
area: api-v2
found: "2026-09-13T13:55:35Z"
merged: "2026-09-13T14:28:06Z"
---

# B1668 — Trip 422 tells a caller to declined.teaser, a key the schema refuses

## Why

`incompleteFrom` (`lib/api/v2/incomplete.ts:70-75`) builds a `to_decline`
string for every "missing" issue by default as
`` `declined.${field}: <reason>` `` unless the issue itself carries an
explicit `toDecline` param. The `teaser` "missing" issue
(`lib/api/v2/schemas/trip.ts:332-339`, raised when a closed trip omits
`teaser`) sets `params: { v2: "missing" }` with **no** `toDecline`, so it
falls through to that generic default and the 422 body tells the caller
`"to_decline": "declined.teaser: <reason>"`.

That is false. `teaser` is not in `DECLINABLE_KEYS`
(`lib/api/v2/schemas/trip.ts:186`: `["rates","costs","plan","days",
"translations","accent","cover","figures","tagline","intro","listed",
"buddies"]` — no `teaser`), and `declined` is
`declinedMap(DECLINABLE_KEYS)`, a `z.partialRecord` over that closed enum. A
caller that follows the API's own advice and sends
`{"declined": {"teaser": "..."}}` gets a second refusal —
`{"field": "declined", "problem": "Unrecognized key: \"teaser\""}` — with no
indication that the first answer was wrong, only that this key specifically
is not allowed. `teaser` is not actually declinable at all: on a closed trip
it is a plain required boolean (`teaser: true` or `teaser: false`), per the
`whyRequired` text of the very same issue.

Verified live against `https://fernscout.ch/api/v2/test-v2review/trips/...`
(scratch journal, deleted after): a `PUT` for a private trip with every other
declinable answered by `declined.<field>` came back demanding `teaser` with
exactly `"to_decline": "declined.teaser: <reason>"`; sending that decline was
refused as an unrecognized key. This is exactly the class of harm
`docs/v2-migration/06-contract-deltas.md` D8/D10/B263/B277/B839 already
called out: a caller following a documented decline path burns a round trip
on a wrong instruction rather than a working one.

## Work

Fix the source of the false hint rather than special-casing the client-facing
default: `lib/api/v2/schemas/trip.ts:332-339`'s issue should set
`params: { v2: "missing" }` with no implied decline path — either omit
`toDecline` cleanly by teaching `incompleteFrom` that "no `toDecline` param"
means "not declinable" (and rendering the row's `to_decline` field as
`null`/absent rather than a guessed string), or set an explicit
`toDecline: undefined`/marker there. Check `listed`'s equivalent
`superRefine` issue for the same shape of bug — `listed` IS in
`DECLINABLE_KEYS` so its default-generated `declined.listed: <reason>` string
happens to be correct today, but it is correct by accident of the field name
matching, not because anything enforces that. Consider a lint/test that
walks `TRIP_DECLINABLES`/`DAY_DECLINABLES`/custom `v2: "missing"` issues and
asserts every generated `to_decline` key actually appears in that schema's
`DECLINABLE_KEYS`/`declinedMap` enum.

## Acceptance

A 422 for a missing `teaser` no longer claims `declined.teaser` is a valid
way to answer it. A test in `test/api-v2-schemas.test.ts` (or a new
contract-level test) fails if any future declinable-looking "missing" issue
generates a `to_decline` hint naming a key its own schema's `declined` map
does not accept.
