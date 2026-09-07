---
id: B720
title: Every upload decodes the whole day again
type: ISSUE
priority: medium
complexity: medium
area: api, media
found: "2026-09-07T11:44:10Z"
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
