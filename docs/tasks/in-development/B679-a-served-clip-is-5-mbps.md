---
id: B679
title: A served clip is 5 Mbps, so a five-minute one costs a reader 190 MB
type: ISSUE
priority: high
complexity: low
area: media pipeline
found: "2026-09-07T09:21:08Z"
started: "2026-09-07T09:23:00Z"
session: d7d9b2c7-a675-4d23-9205-0830bbf3e059
claimed: "2026-09-07T09:23:00Z"
---

# B679 — A served clip is 5 Mbps, so a five-minute one costs a reader 190 MB

## Why

`transcodeVideo` in `lib/ingest/video.ts` asks for `-crf 24` at up to 1280px
with no bitrate ceiling, and on real phone footage that lands between 3.7 and
5.1 Mbps. Measured on four clips put through the API door on 2026-09-07:

| clip | length | served |
| --- | --- | --- |
| 04.mp4 | 22s | 13 MB (5.1 Mbps) |
| 05.mp4 | 30s | 14 MB (4.1 Mbps) |
| 06.mp4 | 95s | 42 MB (3.7 Mbps) |
| 07.mp4 | 177s | 107 MB (5.1 Mbps) |

That is roughly 38 MB per minute, sent to **every** reader who opens the day —
so the five-minute clip the door now accepts is a ~190 MB download on somebody's
mobile data, and the same bytes off the VPS every time. It was survivable while
the cap was 90 seconds and is not now: the length cap moved and the bitrate
that made it tolerable did not.

The comment on `MAX_EDGE` says clips are capped "well below the photo size…
the difference between a 4 MB file and a 40 MB one", which is a claim about
this pipeline that the pipeline does not keep.

## Work

Give the encode a ceiling: `-maxrate`/`-bufsize` around 1.5–2 Mbps for a
1280px clip, or a higher `crf`, whichever looks better on the two real clips in
the fixture. `-crf` alone is quality-targeted and has no upper bound by
design, which is why a busy frame costs whatever it costs.

Look at the result before choosing a number — this is a drawing, not a
function. Both doors use this one call, so ingest gets the same change.

Not doing: multiple renditions or HLS. One file per clip is the shape here.

## Acceptance

- The same four clips re-encoded come out under ~2 Mbps, and a person has
  watched one and said it still looks right.
- A test asserting the ffmpeg arguments carry a bitrate ceiling, so it cannot
  quietly go back to unbounded.
- The `MAX_EDGE` comment's claim about file size is true again, or corrected.
