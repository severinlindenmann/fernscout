---
id: B1503
title: A media file belonging to no day cannot be written through any door
type: ISSUE
priority: medium
complexity: low
area: api, media
found: "2026-09-11T18:31:59Z"
---

# B1503 — A media file belonging to no day cannot be written through any door

## Why

Found while researching B1495 (the sync ticket), which needs to push a folder's
files up through the typed routes and discovered this one cannot be pushed at
all.

`POST /api/v1/<user>/trips/<trip>/media` requires a `day` slug that already
exists — `dayProblem`, `app/api/v1/[user]/trips/[trip]/media/route.ts:87` — and
the call both stores the bytes *and* splices the photograph into that day's
`gallery:` block. The two are one action, so there is no way to put a
photograph in a trip's `media/` that no day yet references.

That is wrong in at least two ordinary situations, neither invented for the
ticket that found it:

- **A cover before its day.** `PATCH .../trips/<trip>` accepts a `cover:` only
  when the photograph is already in the trip's gallery
  (`lib/api/tripDetails.ts`), and the gallery only fills as days are written.
  So a trip cannot be given a cover until some day happens to carry the right
  photograph.
- **A folder that legitimately holds one.** A journal restored from a backup,
  or edited on a laptop, can hold a media file whose day has not arrived yet.
  Nothing can send it.

`DELETE` has the mirror of the same problem: it detaches a photograph from a
day's gallery, so a file on disk that no day references cannot be removed
through the API either.

This is not a hole in `inbox/` — that is the place for a file that belongs to
no day yet, and it works. It is a hole in the trip's own `media/`, for a file
that belongs to *this trip* and not yet to a day in it.

## Work

Decide first whether the answer is a door or a redirection: it may be that the
right answer is "use the inbox, then attach", in which case the fix is that the
refusal says so rather than a new route. If a door is wanted, the shape is a
`day`-less `POST` that stores bytes and splices nothing, and a `DELETE` that
can remove a file no gallery names — both of which must call `storageRefusal`
(`lib/storageQuota.ts:183`), since it is not middleware and every byte-writing
call site invokes it itself.

Whatever is decided, `lib/api/openapi.ts` carries it with a refusal documented.

## Acceptance

- A photograph can reach a trip's `media/` without naming a day, or the
  refusal explains the supported route in words an agent can act on.
- A media file no day references can be removed through the API.
- A trip can be given a cover before any day carries that photograph.
- `npm run verify` green.
