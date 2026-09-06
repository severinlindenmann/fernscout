---
id: B605
title: A photograph on a day cannot be removed over the API
type: FEATURE
priority: medium
complexity: medium
area: media, api
found: "2026-09-06T15:01:20Z"
started: "2026-09-06T15:13:16Z"
session: 302202e0-2cc6-4652-a548-b27b8ba57337
claimed: "2026-09-06T15:13:16Z"
---

# B605 — A photograph on a day cannot be removed over the API

## Why

There is no editing interface (decision 24), so what an agent cannot do cannot
be done. Photographs can be added — `POST
/api/v1/<user>/trips/<trip>/media` — and never taken away.

`EDITABLE_DAY_FIELDS` in lib/api/entries.ts:678 does not include `gallery`, and
deliberately so: `src`, `width` and `height` are measured off the file and
rewriting them from a request body is how a day comes to point at photographs
that are not there (B522). The exception carved out there is `captions`, which
edits the caption line inside items that already exist. Removal was never
carved out at all, so the only remedy today is a shell on the server, which is
the thing the whole API exists to avoid.

Found while cleaning up B604: eleven duplicated photographs on
`severin/algarve-2026`, correctly identified over the API and impossible to
remove through it.

## Work

- `DELETE /api/v1/<user>/trips/<trip>/media` taking one or more `src` values,
  or a `removeMedia: [src]` field on the day PATCH. Prefer the former: the
  route already owns the media directory and the day's `gallery:` block is
  written from it.
- A `src` the day does not carry is refused by name, not ignored — B540's
  lesson, and the same check `checkCaptions` already makes.
- Remove the derivative *and* the kept original, and rewrite the day's
  `gallery:` block. Do not renumber what is left: the file names are what
  anything else pointing at them uses.
- Owner or trip-person, the same gate the upload has. Not a trip-scoped
  token's business to widen.
- Decide what it does to a photobook or postcard order already referencing the
  file. Probably nothing — the order is a record of what was sent — but say so.

## Acceptance

An agent holding an owner token can remove a named photograph from a day, the
gallery no longer shows it, `getTripStats().totalMedia` drops by one, and the
file is gone from `content/<user>/trips/<trip>/media/<slug>/`. A `src` that is
not on the day answers 400 naming it.
