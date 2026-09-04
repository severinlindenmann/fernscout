---
id: B232
title: The reactions endpoint answers for a trip nobody may read
type: SECURITY
priority: medium
complexity: low
area: api, reactions, privacy
found: "2026-09-04T07:59:28Z"
---

# B232 — The reactions endpoint answers for a trip nobody may read

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`app/api/reactions/route.ts:16` and `:54` resolve the trip with `getTrip` and
stop there. `mayReadTrip` is never called, on either verb.

```ts
if (!tripId || !getTrip(tripId)) {
  return NextResponse.json({ error: "unknown_trip" }, { status: 400 });
}
```

Two consequences, both reachable with `curl` and no credential.

**An existence oracle over a guessable id.** A `private` trip answers `200`; a
trip that does not exist answers `400 unknown_trip`. Trip ids are chosen by
hand and guessable by construction — that is the premise of B117, which took
the trip's *title* off the sign-in gate precisely because "anyone willing to
try a short dictionary against a URL" would otherwise learn it. Every write
route in the codebase is careful about exactly this: `mayWriteTrip` answers 404
for a trip that is not yours *and* for one that does not exist, and
`lib/api/auth.ts` explains at length why. This endpoint hands the answer over.

**Day slugs out of a closed trip.** `getAllCounts` returns a map keyed by day
slug (`lib/reactionSet.ts`, `reactionKey`), and a slug is
`slugify(entry.title)`. So a closed trip that anybody has reacted to also
publishes a lossy copy of its day titles to any anonymous caller. It needs a
reaction to exist, which the POST below supplies.

**And anyone can write those rows.** `POST` gates on the same `getTrip`, so a
stranger can record reactions against days of a trip they may not read. It is
rate-limited by IP and bounded to three emoji, so this is graffiti rather than
disclosure — but it is also what makes the slug leak self-serve if the
attacker already knows a slug.

Separately, and worth folding in: the route never asks
`isEnabled("reactions", username)`. A journal that switched reactions off in
its `config.json` still accepts and reports votes through this endpoint. That
is B165's shape one endpoint over — the capability was in `FEATURE_NAMES` and
nothing on the write path asked.

Found by the B22 sweep; see `docs/security/2026-09-04-sweep.md`.

## Work

- `GET` and `POST` both ask `mayReadTrip(trip)`. A refusal answers **the same
  way as a trip that does not exist** — `400 unknown_trip`, unchanged — so the
  oracle closes rather than moving.
- Ask `isEnabled("reactions", username)` too, and answer 404 when it is off, in
  the same shape `lib/tripGate.ts` uses for costs.
- `mayReadTrip` reads the guest cookie, so a reader who *may* open the trip
  still reacts. Check the client provider's request carries credentials.
- Consider whether `getVotesFor` needs the same gate; it is already scoped to
  the journal (`scopeToJournal`) and returns only the caller's own picks.

Not doing: changing the reaction set, the voter-id scheme, or the rate limit.

## Acceptance

- `test/sweep-b22-disclosure.test.ts` — the two `B232` cases flip: a `private`
  trip and an invented id both answer `400 unknown_trip` to an anonymous
  caller, and the anonymous vote is refused.
- A signed-in reader with a live grant still sees and records reactions on a
  `guest` trip.
- `test/reactions.test.ts` passes, updated where it assumed no gate.
- All four checks pass.
