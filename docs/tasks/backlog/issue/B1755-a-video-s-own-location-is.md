---
id: B1755
title: A video's own location is thrown away, though ffprobe already hands it back in the call that reads its date
type: ISSUE
priority: medium
complexity: low
area: ingest, video
found: "2026-09-14T20:29:17Z"
---

# B1755 — A video's own location is thrown away, though ffprobe already hands it back in the call that reads its date

## Why

`probeVideo` (`lib/ingest/video.ts:183`) asks ffprobe for `format_tags` and
reads exactly one of them, `com.apple.quicktime.creationdate`
(`readCreationTime`, line 80). The same response carries
`com.apple.quicktime.location.ISO6709`, and nothing reads it: `VideoProbe`
(line 62) has `durationSeconds`, `width`, `height` and `takenAt`, and no
latitude or longitude. `grep -rn ISO6709 lib/` returns nothing.

So a clip filmed on the same walk as the photographs beside it gets no
location, while they do — and the day it lands on may be placed from its
neighbours rather than from the clip's own coordinates, which were sitting in
the file the whole time.

Observed on a real clip from B1750's handset run — an iPhone 15 `.mov`,
uploaded through Safari:

```
$ ffprobe -v error -show_entries format_tags -of json IMG_5520.mov
"com.apple.quicktime.location.accuracy.horizontal": "29.347444",
"com.apple.quicktime.location.ISO6709": "+47.4156+008.2563+389.847/",
"com.apple.quicktime.make": "Apple",
"com.apple.quicktime.model": "iPhone 15",
"com.apple.quicktime.creationdate": "2026-07-06T19:35:08+0200"
```

`creationdate` is read and is correct — worth saying, because the obvious
adjacent bug is not there. The generic `creation_time` on that same file is
`2026-09-14T20:25:21Z`, the moment Safari exported it for upload, and
`readCreationTime` already prefers the Apple key over it. That part of this
file is right and the comment at line 70 explains why.

## Work

Parse ISO 6709 into `lat`/`lng` on `VideoProbe` and use it where a photograph's
EXIF position is used. The format is a fixed-sign string —
`+47.4156+008.2563+389.847/` — latitude, longitude, optional altitude, trailing
solidus; signs are always present, so the parse is a regex rather than a
library. Altitude is available too and `ExifData` already carries one.

Also worth taking in the same pass, since they are tags in the same response
and the photograph path already records the equivalents:
`com.apple.quicktime.make` / `.model`, and
`.location.accuracy.horizontal` — which is the video's answer to
`GPSHPositioningError`, and the thing that says whether a coordinate is worth
trusting.

Nothing here changes what happens to a clip with no location: it still falls
back to its neighbours, exactly as a photograph without EXIF does.

## Acceptance

- A `.mov` carrying `com.apple.quicktime.location.ISO6709` imports with the
  coordinates from that tag, and a test asserts the parse against the literal
  string above, including the altitude and both signs.
- A clip with no location tag still imports and is still placed from its
  neighbours — no regression, no invented coordinate.
- A negative-hemisphere string (`-33.8688+151.2093/`) parses correctly. The
  sign is part of the format and a naive split on `+` loses it.

## Related

Found while reading the first handset run for B1750. B1751 needs this — an
import built out of somebody's camera roll will have clips in it, and a video
that drops its own position is a day placed from a guess.
