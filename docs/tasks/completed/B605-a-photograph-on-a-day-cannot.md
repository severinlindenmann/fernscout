---
id: B605
title: A photograph on a day cannot be removed over the API
type: FEATURE
priority: medium
complexity: medium
area: media, api
found: "2026-09-06T15:01:20Z"
started: "2026-09-06T15:13:16Z"
merged: "2026-09-06T15:35:33Z"
completed: "2026-09-07T13:12:23Z"
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

## Built

`DELETE /api/v1/<user>/trips/<trip>/media`, body `{ "day": "<slug>", "src":
["<one or more, exactly as GET .../days/<slug> hands back in gallery>"] }`.
Every `src` is matched against the day's own `gallery:` by `mediaKey` — never
trusted as a path built from the request — and one naming no photograph the
day has refuses the whole call with `400 invalid_media`, naming it in
`problems`, rather than removing the rest and leaving the caller to notice
which one silently did not land. Same auth gate as the upload
(`mayWriteTrip`): owner or trip-person only, and a token scoped to a
different trip in the same journal gets the same `404 unknown_trip` any
other trip it does not name would.

The work landed as two new functions rather than one, following the existing
split between `lib/api/media.ts` (owns the files on disk) and
`lib/api/entries.ts` (owns the frontmatter):

- `detachGallery(ref, slug, srcs)` (lib/api/entries.ts) — matches, deletes
  the files (see below), then splices the matched items out of the
  `gallery:` block textually (`removeGalleryItems`, the removal counterpart
  to the existing `spliceGalleryField`), dropping the `gallery:` key too once
  nothing is left under it. Files are deleted *before* the frontmatter is
  rewritten: a failure between the two steps leaves a `gallery:` line
  pointing at a file that is already gone (safe — 404) rather than a file
  still reachable at its old, guessable URL after the day says it does not
  exist (the same reasoning the photoVisibility label already gets in
  `app/[user]/media/[...path]/route.ts`).
- `deleteMediaFiles(ref, item)` (lib/api/media.ts) — deletes the derivative
  and poster through `resolveMediaFile`, the same guarded resolve the read
  route uses, and the kept original by the derivative's own stem (`storeUploads`
  numbers both from the same index but the two can carry different
  extensions — a HEIC original behind a JPEG derivative — so neither name
  predicts the other's; a directory scan by stem finds it either way). Every
  path comes from a gallery item already matched against the day's own file,
  never built from the request body directly, and a `src` whose embedded
  trip id does not match the trip being edited is left alone rather than
  resolved into that other trip's media directory (only reachable by
  hand-editing frontmatter, which is the owner's own content to begin with,
  but checked rather than assumed).

**Decision on photobook/postcard orders:** left untouched, and said so in
both the response `note` and the OpenAPI description. Verified rather than
assumed: `lib/postcard/send.ts`'s `orderPhotoFile` and
`lib/photobook/source.ts`'s `mediaFileFor` both resolve the photograph live,
at send/print time, from `order.payload.photo` — a `src` string, not a copy
of the bytes. So deleting a photograph a *pending* order names will make that
order fail to send with the same graceful failure it already has if an owner
deleted the file by hand (`readPhoto` returns null, handled upstream as a
send failure) — not a new failure mode, just a reachable one now. A
completed order already has its bytes at the printer and is unaffected
either way.

**Contract:** `lib/api/openapi.ts` gets the `delete` verb on
`/api/v1/{user}/trips/{trip}/media`, with its request schema and three
refusals (`400` for a bad `src`, `404` for an unknown day). `lib/api/agentCopy.ts`'s
`gallery` field note (what `/agent.md` says about `POST .../media`) now
mentions the removal call too. Two new codes,
`expected_src` and `unknown_media`, added to `lib/api/errorCodes.ts` —
`test/openapi-contract.test.ts`'s `ERROR_CODES` completeness check caught
their absence immediately.

**Tests:** `test/media-removal.test.ts` — the route end to end (success,
unknown `src`, wrong-trip token, unknown day, empty `src`, a video's poster
going with the clip) and `detachGallery` directly (an original kept under a
different extension than its derivative, unrelated frontmatter and prose
surviving the splice, a hand-edited `src` naming a different trip left
alone).

`npm run verify` passes in full.
