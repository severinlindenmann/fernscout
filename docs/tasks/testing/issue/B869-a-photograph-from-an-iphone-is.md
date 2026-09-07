---
id: B869
title: A photograph from an iPhone is replaced by a wrong picture and called a success
type: ISSUE
priority: high
complexity: medium
area: media, ingest
found: "2026-09-07T17:36:50Z"
started: "2026-09-07T18:41:32Z"
merged: "2026-09-07T19:07:22Z"
---

# B869 — A photograph from an iPhone is replaced by a wrong picture and called a success

## Why

A HEIC — what every iPhone produces — is accepted with `201`, and what the site
then shows is **a different picture**.

Tested live on 2026-09-07 with a valid 1600×1200 HEIC:

```json
{"items":[{"src":".../01.jpg","width":512,"height":512}],
 "kept":[{"filename":"scene.heic","bytes":11301,"width":512,"height":512}]}
```

The served image is 512×512 and contains only a strip of sky — no sun, no sea,
no boat. Not a crop and not a resize: a different image. `sips` decodes the
same file correctly at 1600×1200, so the file is sound.

Nothing in the answer says anything went wrong. There is no warning field, the
dimensions are stated with confidence, and **`kept` — which exists so a caller
can see the original survived rather than infer it from a promise — reports the
same wrong size.** So the one place the API proves the print original is intact
cannot be trusted for this format.

**Diagnosis.** `lib/ingest/image.ts` knows sharp cannot decode HEVC-coded HEIC
and falls back to `heif-convert`, then `sips`, then `ffmpeg`. On the server:

```
heif-convert   MISSING
sips           MISSING
ffmpeg         present
```

So the chain has exactly one candidate left, and locally `ffmpeg` cannot read
this file at all (`moov atom not found`). Something is nonetheless producing a
512×512 image and reporting success — most likely an embedded thumbnail being
taken for the picture.

This is the worst failure shape in the media pipeline: confident, silent, and
on the commonest camera format there is.

## Work

Two halves, and the second matters more than the first.

1. **Install a real decoder on the server** — `libheif-examples` gives
   `heif-convert`, which is first in the existing chain. That is an ops change,
   and `docs/runbook.md` should name it beside ffmpeg.
2. **Never report success for a picture you could not decode.** `sharp`'s own
   metadata reads this file correctly at 1600×1200; the decoded result is
   512×512. Those disagreeing is a checkable invariant: if the decode does not
   match the declared dimensions, refuse the upload and say why, rather than
   serving whatever came back. `UndecodableImageError` already exists for the
   throwing case; this is the silent case.

## Acceptance

An iPhone photograph is either stored correctly or refused with a message
naming the reason. It is never replaced by a different picture and called
`201`.
