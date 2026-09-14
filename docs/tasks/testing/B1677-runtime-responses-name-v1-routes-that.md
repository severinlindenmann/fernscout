---
id: B1677
title: Runtime responses name v1 routes that were deleted
type: ISSUE
priority: medium
complexity: low
area: api
found: "2026-09-13T14:28:33Z"
merged: "2026-09-14T07:06:47Z"
---

# B1677 — Runtime responses name v1 routes that were deleted

## Why

Several routes build **response strings** naming v1 doors that were deleted.
These are not doc comments — they are what a caller is told to do next:

- `app/api/auth/handover/route.ts:79,82` and
  `app/api/auth/[user]/handover/route.ts:142` — `status: GET …/api/v1/<user>/status`.
  That route answers 404 (verified live); v2's is `/api/v2/{user}/status`.
- `app/api/auth/signup/phone/redeem/route.ts:68,88` —
  `next: "POST /api/v1/journals"`. 404; v2's is `POST /api/v2/journals`.
- `app/[user]/me/delete/route.ts:31` and
  `app/[user]/trips/[trip]/delete/route.ts:36` — tell the owner the agent door
  is `DELETE /api/v1/<user>…`.
- `lib/api/errorCodes.ts:32` — `missing_token` says "Every /api/v1 call needs
  one".
- `lib/api/agentCopy.ts:522,643`, `lib/inboxUpload.ts:228`,
  `lib/tripWrite.ts:803` — the same, inside copy an agent reads.
- `lib/api/status.ts:51` — `draftQueue` builds
  `POST …/api/v1/…/days/<slug>/publish`. Reachable only from
  `test/test-content.test.ts` today, so it is dead code that produces a dead
  URL; decide whether it should exist at all.

An agent following any of these calls a 404. This is the exact failure class
the migration existed to remove — the API telling a caller to do something
that cannot be done.

## Work

Sweep every **string returned to a caller** (not doc comments) for `/api/v1`
and repoint it at the v2 door, or at the surviving v1 route where that is
genuinely the answer (`PATCH /api/v1/{user}/config` is still real).

Add a test that greps the built response copy for `/api/v1/` and allows only
the three surviving routes — so a fourth cannot appear silently.

Not doing: the historical prose in module comments, which is a record of where
code came from and is correct as history.

## Acceptance

- Every route path named in a v2 response resolves to a route file on disk.
- A test enforces it.
