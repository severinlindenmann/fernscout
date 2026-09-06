---
id: B632
title: A day cannot be held back to guests or to the people who were there
type: FEATURE
priority: high
complexity: high
area: content model, day visibility
found: "2026-09-06T17:51:45Z"
started: "2026-09-06T19:29:15Z"
session: e5f23c58-bb87-4175-ad7b-5d3aed93169f
claimed: "2026-09-06T19:29:15Z"
---

# B632 — A day cannot be held back to guests or to the people who were there

## Why

`visibility:` today exists on a trip and, since B596, on a single photograph. It
does not exist on a **day**. So an owner who wants one entry of a public trip
kept to guests, or to the people who were there, has no way to say it — the
only lever is `status: draft`, which is "not finished", not "not for everyone".

Two entries on one day is normal (AGENTS.md says so), and the case that
prompted this is exactly that: one entry for everybody, one for guests. A guest
should see both; a stranger should see the first.

The vocabulary and the machinery already exist and should be reused rather than
reinvented: `PHOTO_VISIBILITIES` and `maySeePhoto` in `lib/photos.ts` are the
narrowing rule, `readFor` in `lib/tripGate.ts` is the reader's level, and
`visible()` in `lib/entries.ts` is where the stripping happens.

## Work

- An entry may carry `visibility: guest | private`. It narrows and never widens
  against the trip's own value — the same sentence `lib/photos.ts` already
  makes about a photograph, and probably the same function.
- Three halves, and any one missing makes it a leak: the read paths in
  `lib/entries.ts`, the day's own route and `.md` source, and the feed, sitemap
  and search index (`isIndexable` in `lib/access.ts`).
- Document it: `/agent.md`'s entry field list and the request schemas in
  `lib/api/openapi.ts`. A field the API takes must be readable back.
- To the owner and the people on the trip, say on the day which value it
  carries — otherwise nobody can check their own work. That is the same need as
  B631 and should look like it.
- `/<user>/me` tells a reader what they can read. It lists trips; it should say
  when what they are being let into is the guest-only part rather than all of
  it.

## Acceptance

- On a `public` trip, an entry marked `guest` is absent for a signed-out reader
  — page, feed, sitemap, search index and `.md` source — and present for an
  approved guest.
- A day with a public entry and a guest entry shows one to a stranger and both
  to a guest.
- A `guest` entry inside a `private` trip stays private.
- `/openapi.json` documents the field and some documented `GET` reads it back.
