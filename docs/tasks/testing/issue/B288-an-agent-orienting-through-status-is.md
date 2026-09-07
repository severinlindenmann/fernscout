---
id: B288
title: An agent orienting through status is not told a trip.md failed to load, though the trip list would tell it
type: ISSUE
priority: low
complexity: low
area: api, agents
found: "2026-09-04T13:15:00Z"
started: "2026-09-07T10:37:39Z"
merged: "2026-09-07T11:05:30Z"
---

# B288 — An agent orienting through status is not told a trip.md failed to load, though the trip list would tell it

## Why

Found while building B91 and captured rather than absorbed, because B91's Work
section lists what `/status` carries and this is not on it.

`GET /api/v1/<user>/trips` surfaces trips that are on disk but too broken to
parse — `getMalformedTrips(user)` at `app/api/v1/[user]/trips/route.ts:26`,
owner tokens only, with a `next` telling the agent to fix the named file and
read again. B83 is why: without it, an agent that had just written a `trip.md`
saw the write succeed and every subsequent read pretend the trip was not there.

`/api/v1/<user>/status` (`lib/api/status.ts`) does not carry them. So the new
guidance — "get your bearings in one call, then work from it" — has a hole in
exactly the situation B83 was about: an agent creates a trip, the file does not
parse, status reports the journal's trips without it, and the agent concludes
its trip does not exist rather than that it is broken. Reading `/trips` would
have told it; the guide now says it does not need to.

Small, and only reachable right after a malformed write, which is why it is
low priority rather than a bug in what shipped.

## Work

Carry `malformed` into the status response, on the same terms the trips route
already sets: **owner tokens only** — a trip-scoped token learns nothing about
the rest of the journal, malformed or not — and reusing `getMalformedTrips`
rather than a second reader.

`nextStep` in `lib/api/status.ts:79` should mention it, and ahead of the draft
queue: a broken trip file is a thing the agent may have just caused and can
fix, where the drafts are a thing a person has to decide. Put it first for the
same reason the drafts route puts its own `next` where it does.

## Acceptance

- With a malformed `trip.md` on disk, `GET /api/v1/<user>/status` with an owner
  token names it, and `next` says to fix it.
- The same call with a trip-scoped token does not, matching
  `app/api/v1/[user]/trips/route.ts:26`.
- A test covers both, beside the ones in `test/status.test.ts`.

## Resolution

`lib/api/status.ts` (`journalStatus`) now calls `getMalformedTrips(user)` on
the same terms `app/api/v1/[user]/trips/route.ts` already does — reusing the
`scoped` boolean `journalStatus` already computes (`session.scope !==
SESSION_SCOPE.agent`), which is exactly the check the trips route makes
inline. `malformed` is added to the response only when non-empty, matching
the trips route's own shape. `nextStep()` gained a `malformed` parameter and
checks it first, ahead of the inbox and draft branches, naming the count and
telling the agent to fix the file and read status again — the same
instruction the trips route gives.

Documented in `lib/api/openapi.ts` (the `/api/v1/{user}/status` GET
description) and in the agent guide (`lib/api/documentation.ts`, the
"Picking up somebody else's journal" section).

Test: `test/status-malformed.test.ts` (new file, to avoid perturbing
`test/status.test.ts`'s shared `beforeAll` fixture, whose existing "next"
assertions assume no malformed trip is present) — an owner token sees
`malformed` naming the broken folder and `next` mentioning it; a trip-scoped
token sees neither; a journal with nothing broken has no `malformed` key at
all. All three fail against the pre-fix `status.ts` (no reference to
`getMalformedTrips` existed).

`npm run verify` green (see final report).
