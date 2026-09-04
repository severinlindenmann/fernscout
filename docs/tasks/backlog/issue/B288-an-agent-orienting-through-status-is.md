---
id: B288
title: An agent orienting through status is not told a trip.md failed to load, though the trip list would tell it
type: ISSUE
priority: low
complexity: low
area: api, agents
found: "2026-09-04T13:15:00Z"
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
