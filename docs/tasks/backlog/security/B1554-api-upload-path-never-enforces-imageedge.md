---
id: B1554
title: API upload path never enforces imageEdge; pixel bombs bounded only by sharp defaults and HEIC fallback unbounded
type: SECURITY
priority: medium
complexity: medium
area: media/uploads
found: "2026-09-11T23:06:54Z"
---

# B1554 — API upload path never enforces imageEdge; pixel bombs bounded only by sharp defaults and HEIC fallback unbounded

## Why

`lib/api/media.ts:359-364` builds upload candidates with `name/kind/format/bytes`
only — `longestEdge` is never populated, so the `limits.imageEdge` check in
`lib/validate/media.ts:191-197` is dead code on the network path. The only
caller of `sourceLongestEdge` is the CLI ingest (`lib/ingest/index.ts:254`),
even though `/api/health` advertises `media.imageMaxEdge` as a ceiling. No
`limitInputPixels` override exists, so sharp's ~268 MP default is the real
bound: a few-hundred-KB crafted PNG decoding to 16000×16000 costs ~1 GB of
decode memory in `greyGrid`/`makeDerivative`, re-paid on `dayFingerprints`
cache misses (`media.ts:277-286`), 40 files per request, unbounded across
concurrent requests. The HEIC fallback (`lib/ingest/image.ts:124-190`) shells
out to `heif-convert`/`ffmpeg` with no pixel or output-size limit at all and
writes into `os.tmpdir()`.

## Work

- Populate `sourceLongestEdge` in `storeUploads`' candidates so the existing
  `imageEdge` check fires on the API path.
- Set an explicit `limitInputPixels` matching `imageEdge²` wherever sharp
  decodes user bytes.
- Bound the HEIC/ffmpeg fallback's output (pixel cap or output byte cap).

## Acceptance

An upload whose decoded edge exceeds `imageMaxEdge` is refused with the
documented error rather than decoded; a crafted small-bytes/huge-pixels PNG is
refused before decode. Ordinary photos within limits are unaffected.
