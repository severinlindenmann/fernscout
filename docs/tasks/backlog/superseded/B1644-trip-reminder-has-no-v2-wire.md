---
id: B1644
title: Trip reminder has no v2 wire home — the on/off switch writes a dead trip.md
type: ISSUE
priority: medium
complexity: medium
area: v2-migration
found: "2026-09-13T06:34:27Z"
superseded: \"B1638 — same finding, filed first and carrying the fuller analysis\"
---

# B1644 — Trip reminder has no v2 wire home — the on/off switch writes a dead trip.md

## Why

B1598 moved `lib/trips.ts`'s `getTrip` off `trip.md` onto `trip.json`
(`readTrip`, `lib/trips.ts:621`), and `TripFile` (`lib/api/v2/documents.ts`)
has no `reminder`/`reminderChannel` key at all — `lib/trips.ts:719` hardcodes
`reminder: undefined` on every trip, with the comment "v2 has no wire home
for the evening reminder — see 06-contract-deltas". `docs/v2-migration/
05-status.md:148` already names this as a known, deliberately deferred gap
("cheap to answer later ... Neither blocks").

Meanwhile `lib/api/tripReminder.ts` (`patchTripReminder`) still reads the
trip through `getTrip` (so it now correctly answers `unknown_trip` unless a
`trip.json` exists) but still *writes* by splicing `reminder:`/
`reminderChannel:` scalars into `trip.md` (`spliceScalar`, lines 108-125) —
a file `getTrip` never reads any more, and one that plainly does not exist
for a trip created through `createTrip`/`writeTripFixture` (`lib/tripWrite.ts`
writes only `trip.json`). The read and the write now address two different
files, one of which nothing serves: **the whole evening-reminder capability
is inert for every v2-native trip.** `test/reminders.test.ts` documents this
in full (all 8 cases in "the on/off switch" and "the nightly sweep" describe
blocks) — every case either gets `unknown_trip` (no `trip.json` on disk) or,
once fixture writes a real `trip.json`, would hit `spliceScalar` on a
`trip.md` that does not exist.

## Work

Give the evening reminder a v2 wire home rather than leaving it silently
dead:

- Add `reminder?: { channel: ReminderChannel }` (or equivalent) to `TripFile`
  in `lib/api/v2/documents.ts`, round-tripped by `tripToJson`/`tripFromJson`
  the same way every other optional trip field is.
- Decide whether it belongs on the general `tripCreate`/`tripPatch` wire
  schema (`lib/api/v2/schemas/trip.ts`) or stays a field only
  `lib/api/tripReminder.ts` ever writes directly through
  `lib/api/v2/store.ts`'s `readTripFile`/`writeTripFile` — v1 never let it be
  set at trip-create time either, so the narrower answer (a dedicated
  read/write pair, no `tripCreate`/`tripPatch` surface) matches what shipped
  before and needs no `declined` completeness question added to every other
  trip.
- Update `lib/trips.ts`'s `getTrip` to read `tripFile.reminder` instead of
  hardcoding `undefined` (line 719).
- Rewrite `lib/api/tripReminder.ts`'s `patchTripReminder` to write through
  `writeTripFile` rather than `spliceScalar`/`trip.md`.

This is a schema decision (`lib/api/v2/schemas/` is a frozen contract per
AGENTS.md), so it needs the owner's sign-off on the shape before it is built,
not just an agent's guess.

## Acceptance

`npx vitest run test/reminders.test.ts` passes, against trips written the
normal v2 way (`trip.json`, no `trip.md` on disk at all).
