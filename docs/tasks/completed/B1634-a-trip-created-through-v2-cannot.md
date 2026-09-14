---
id: B1634
title: "A trip created through v2 cannot be deleted through v2 — DELETE resolves it with the v1 reader"
type: ISSUE
priority: high
complexity: low
area: API v2
found: 2026-09-13T00:00:00Z
merged: "2026-09-14T04:54:31Z"
completed: "2026-09-14T16:32:20Z"
---

## Why

Observed live on fernscout.ch, against the deployed v2 API:

```
PUT    /api/v2/example/trips/test-v2-smoke   → 201
GET    /api/v2/example/trips/test-v2-smoke   → 200
DELETE /api/v2/example/trips/test-v2-smoke   → 404 unknown_trip
GET    /api/v2/example/trips/test-v2-smoke   → 200   (still there)
```

The v2 routes write and read `trip.json` through `lib/api/v2/store.ts`.
`DELETE` hands off to `requestDeletion` (`lib/deletions.ts:169`), which
resolves the trip with `getTrip` — the **v1 markdown reader**. A trip that
exists only as `trip.json` is invisible to it, so the call refuses.

Two reasons this matters more than an ordinary 404:

1. **It is unreachable state.** Anything an agent creates through the v2 API
   today cannot be removed through the v2 API at all. The only way out is a
   shell on the server, which is precisely the situation `AGENTS.md` says the
   delete flow exists to avoid ("telling them to delete a line from a file
   was advice with nowhere to go").
2. **The refusal is indistinguishable from a real one.** `unknown_trip` is
   also the honest answer for a trip that never existed and for one this
   token may not touch — deliberately, so the door cannot be used to ask
   which trips exist. So a caller cannot tell "you cannot delete this" from
   "there is nothing here", and will reasonably conclude the trip is gone.

This is the same split-brain B1598's own note describes, surfacing through a
door rather than through a render: v2 writes JSON, a v1 reader is still in
the path, and the two disagree about what exists.

**`GET` masks it.** A shape-only check of the delete flow would pass; only
the create → delete → read-back round trip shows it, which is why it reached
the deployed instance.

## Work

`requestDeletion` and everything under it must resolve a trip the way the v2
routes do. The narrow fix is to have it ask `readTripFile` (or a shared
resolver) rather than `getTrip`; the better one is to make the v2 route pass
the already-resolved document it just read, so there is one read and no
second opinion.

Check the same path for a **journal** deletion, and for
`published_day_not_deletable` on a day — anywhere `lib/deletions.ts` resolves
content, it is resolving it with v1's reader.

**Update, 2026-09-13:** B1598's reader flip fixes this as a side effect —
`getTrip` reads the v2 JSON, so `requestDeletion` resolves the trip and the
route answers `202` with the mail. Confirmed on that branch:
`test/api-v2-trips.test.ts`'s DELETE case, written to pin this bug, now fails
because the behaviour is correct.

That closes the symptom, and the underlying complaint — *two readers
disagreeing about what exists* — closes with it, since there is only one
reader afterwards. What survives is the **test**: the round trip belongs in
the suite whether or not the bug is reachable, because a shape-only check of
the delete flow passed throughout.

**Add the round trip to the test suite**: create through v2, delete through
v2, and assert the 202 and the mail. A test asserting only that DELETE
answers 202 on a fixture-written trip would still pass today.

## Acceptance

- A trip created with `PUT /api/v2/{user}/trips/{trip}` answers `202` to
  `DELETE` on the same path, and the confirmation mail is written.
- The trip is still on disk after the 202 — deleting stays the two-step shape.
- A test drives create → delete → read-back rather than asserting a status.
