---
id: B1641
title: "createTrip wrote people: [] and every trip created without people became unreadable"
type: ISSUE
priority: high
complexity: low
area: API v2
found: 2026-09-13T00:00:00Z
merged: "2026-09-13T08:01:17Z"
---

## Why

`tripDoc.people` is `.min(1)` — *a trip nobody was on is not a trip*, and the
schema says so deliberately. `createTrip` was writing `people: []` when a
caller named nobody.

So the document on disk failed its own schema, and `buildTripDoc`'s
`tripDoc.parse(doc)` threw a **raw `ZodError`** — an uncaught 500 with a
stack, not a refusal through the error envelope — on every read of every trip
created without an explicit `people:`.

v1 omitted the key entirely and let `peopleOf()` merge the owner in at read
time. v2 states it on the document instead, which is the better shape: the
byline is a fact about the trip, not something reassembled per request. The
writer simply had not caught up.

**Fixed on the B1598 branch**: `createTrip` names the journal's own owner when
the caller names nobody.

## What is worth keeping from it

**A raw `ZodError` escaping a route is its own bug**, separate from this one.
Every v2 route is supposed to answer the one error envelope; `buildTripDoc`
parses without a guard, so a stored document that fails its schema for *any*
reason — this, a hand-edit, a future field — becomes a 500 rather than a
refusal naming the problem. Worth a guard there regardless of what wrote the
document.

That is the more general form and this ticket is the instance of it.

## Acceptance

- A trip created with no `people` names the journal's owner, and reads back.
- `buildTripDoc` answers an error envelope, never a raw throw, when a stored
  document does not satisfy `tripDoc`.
- A test writes a deliberately invalid trip.json and asserts the refusal
  rather than a crash.
