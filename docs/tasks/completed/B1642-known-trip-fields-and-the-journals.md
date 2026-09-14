---
id: B1642
title: "KNOWN_TRIP_FIELDS and the journals field-coverage test still speak v1's vocabulary"
type: ISSUE
priority: medium
complexity: medium
area: API v2
found: 2026-09-13T00:00:00Z
merged: "2026-09-14T04:54:32Z"
completed: "2026-09-14T16:32:25Z"
---

## Why

`test/journals.test.ts`'s "every field the reader knows is now either written
or decided" walks `KNOWN_TRIP_FIELDS` (`lib/trips.ts`) and asserts each is
either written by `createTrip` or explicitly decided against. It is a good
test — it is the one that stops a field being quietly forgotten.

Both it and the list it walks still describe v1:

- `start`/`end` are one `dates` object now
- `status` is derived from the dates, never written
- `costsVisibility` is nested under `costs`
- `tracks` has no v2 home at all
- `plan`, `figures`, `intro` and `declined` are fields the v1 list never named

So the test fails, and — worse — `KNOWN_TRIP_FIELDS` is no longer a true list
of what a trip has, which means the guarantee it exists to provide is gone
even where it passes.

Left failing deliberately during the fixture migration, with a note in the
test saying why: reconciling the two against v2's real write contract is
genuine work, not a mechanical repoint, and guessing at it would have
replaced a known-stale list with a plausible-looking one.

## Work

Rebuild `KNOWN_TRIP_FIELDS` from v2's actual trip document, and reconcile the
test's `written`/`decidedAgainst` split against what `createTrip` really does.
Then decide what the list is *for* now that a Zod schema exists: if
`tripCreate` is the authority on what a trip has, the list may be redundant
and the test should walk the schema instead — which would make it
self-maintaining, and is probably the right answer.

Not doing: deleting the test. Whatever replaces it must still fail when a
field is added and nothing writes it.

## Acceptance

- The test passes against v2's vocabulary.
- Either `KNOWN_TRIP_FIELDS` matches the schema, or the test walks the schema
  and the list is gone.
- Adding a field to `tripCreate` and writing nothing still fails it.
