---
id: B676
title: The urls door refuses video: fetchImage takes only image/* content types
type: ISSUE
priority: medium
complexity: low
area: media API
found: "2026-09-07T09:03:57Z"
started: "2026-09-07T09:48:06Z"
session: d7d9b2c7-a675-4d23-9205-0830bbf3e059
claimed: "2026-09-07T09:48:07Z"
---

# B676 — The urls door refuses video: fetchImage takes only image/* content types

## Why

`POST /api/v1/<user>/trips/<trip>/media` takes three doors — multipart bytes,
staged inbox files, and a list of `urls` this server fetches. The third cannot
carry video at all: `fetchImage` in `lib/api/fetchMedia.ts` refuses anything
whose `content-type` does not start with `image/`, and `filenameFrom` maps
everything it keeps onto a `.jpg`/`.png`/`.webp`/`.heic` name — so even if the
type check passed, `kindOf` downstream would call the file a photograph.

The multipart door has taken video since it was written, and both doors are
documented by one limits table that names mp4, mov and webm. So an agent that
reads the guide, sends a clip's URL and is told it "is video/mp4, not an
image" has been refused by a door the document says is open.

It was invisible while a clip could not exceed the 64 MB request cap anyway —
the URL door was the only way a large one could ever have arrived, and it is
the one that says no.

## Work

Give `fetchImage` — or a sibling beside it — the video content types and the
extension mapping to match, and choose the byte ceiling by kind
(`limits.videoBytes` rather than `limits.imageBytes`, which the media route
passes for everything today). The SSRF protections are the valuable part of
that module and are not kind-specific: the pinned transport, the per-hop
address check, the two clocks and the size enforcement while reading all apply
unchanged.

Not doing: probing duration before the download. The bytes have to be on disk
for ffprobe either way, and `storeUploads` already refuses a clip that is too
long after that.

## Acceptance

- `POST …/media` with `{"day": "...", "urls": ["https://…/clip.mp4"]}` stores
  the clip, transcodes it and attaches it, the same as the multipart door.
- A clip past `videoBytes` is refused by size, naming the video cap.
- A URL answering `text/html` is still refused.
- A test in `test/fetch-media.test.ts` for each.
