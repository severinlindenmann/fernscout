---
id: B720
title: Every upload decodes the whole day again
type: ISSUE
priority: medium
complexity: medium
area: api, media
found: "2026-09-07T11:44:10Z"
started: "2026-09-08T21:15:57Z"
merged: "2026-09-08T21:26:51Z"
completed: "2026-09-09T16:46:25Z"
---

# B720 — Every upload decodes the whole day again

## Why

`lib/api/media.ts` `dayFingerprints` decodes every photograph already in the
day on each upload request. One request per file means the nth upload decodes
n−1 images: roughly O(n²) across a batch, and forty photographs is the normal
case this feature is built for.

Nothing regressed — the route was one request per file before B683 too — but
the two-phase queue makes single-file requests the *normal* shape rather than
an oddity of the wizard, so the cost is now on the main path, and it is paid on
a phone waiting for a progress bar.

Found while building B683.

## Work

Cache the fingerprints per day for the life of a batch, or store them beside
the gallery so they are read rather than recomputed.

## Acceptance

Uploading forty photographs decodes each one a bounded number of times, and a
test or a measurement says which.

## Resolution

Confirmed still real before touching anything: `dayFingerprints` in
`lib/api/media.ts` listed the day's directory and decoded every non-video,
non-poster file in it — every call, every request — with nothing remembered
between requests. No sibling ticket in `docs/tasks/` covers it.

**Measured** with `decodeSource` (`lib/ingest/image.ts`) spied on via
`vi.mock`, one file per request (the wizard's normal shape since B683), ten
distinct photographs uploaded to an empty day one request at a time:

- Before: 55 calls to `decodeSource` — 10 for the arriving files (unavoidable;
  that decode builds the derivative) plus 0+1+…+9 = 45 for re-decoding what
  was already on the day, exactly the O(n²) the ticket named.
- After: 10 calls — one per arriving file, zero for anything already on the
  day.

`test/media-upload-decode-cache.test.ts` asserts both the ten-request batch
count and that a second single-file request after a first decodes only the
new file (1 call, not 2). Reverting the fix and re-running that file
reproduces the "before" numbers above exactly (55 and 2).

**What changed**: `dayFingerprints` now reads and writes a small sidecar,
`.fingerprints/<slug>.json` at the trip's root (beside `.ingest.json`, not
inside `media/` — see below), keyed by filename with the size and mtime the
fingerprint was taken at. A file already in the cache at its current size and
mtime is a fact already known and is not decoded again; anything new, or
changed since, is decoded once and the result is written back. The directory
listing is still the source of truth for *which* files exist on the day — a
photograph removed by `DELETE .../media` (B605) simply stops appearing in the
listing next time, and the stale cache entry beside it is inert (never read,
eventually overwritten). `storeUploads` also records what a batch itself just
wrote into the same cache, so the very next request never re-decodes it
either.

The cache lives at `tripDir(ref)/.fingerprints/<slug>.json` rather than
inside `tripMediaDir`/`media/<slug>/`, deliberately: that directory is served
straight to readers by `app/[user]/media/[...path]/route.ts`, and a file the
gallery does not mention still falls under the day's own visibility there
(see `labelOf` in that route) rather than being refused outright. A decode
cache has no reason to be reachable by URL at all, so it sits where
`.ingest.json` already does — a location that route never resolves into.

No API surface changed: nothing new is accepted or returned, so
`lib/api/openapi.ts` and `/agent.md` needed no update. `kept` in the upload
response, the per-day item ceiling, and both B596 visibility checks
(`visible()` in `lib/entries.ts` and the media route) are untouched — this
only changes how a fingerprint already computed is remembered, never what is
computed or what is written to a day's frontmatter.

**B708 and B670**: not touched. Neither the per-day item ceiling's counting
rule nor the video-originals omission in the response's `kept` field was
read or changed.

**Verify**: `npm run verify` — build, tsc, eslint, vitest (full suite),
knip — all green. See the commit for the exact run.
