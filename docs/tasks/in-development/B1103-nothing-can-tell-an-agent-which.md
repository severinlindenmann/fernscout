---
id: B1103
title: Nothing can tell an agent which photographs on a trip are the same picture twice
type: FEATURE
priority: medium
complexity: low
area: API / media
found: "2026-09-09T16:25:02Z"
started: "2026-09-09T16:25:25Z"
session: 8aa24275-7346-4bf6-99b4-24c983c9f0c9
claimed: "2026-09-09T16:25:25Z"
---

# B1103 — Nothing can tell an agent which photographs on a trip are the same picture twice

## Why

`severin/algarve-2026` carries eleven photographs that are a second copy of a
photograph already on the same day — the full-resolution camera file and, next
to it, the same shot as it came back off a messaging app at 1500x2000 and a
twentieth of the bytes. Byte-identical they are not, so nothing on the instance
noticed: the two files differ in every byte, in dimensions and in EXIF
orientation, and only a person looking at the gallery can see they are one
picture.

`DELETE .../media` (B605) can already take one off. What is missing is the half
before it — an agent has no way to *find* them, and asking it to eyeball a
seventy-five-photograph trip is asking it to invent an answer.

Orientation is the trap and is worth writing down: the camera file stores the
frame landscape with an EXIF rotation tag, the messaging-app copy has the
rotation baked in. Compare the pixels without applying the tag first and the
two are unrelated images — that is exactly what a first pass over this trip
reported, zero duplicates, confidently.

## Work

- `findDuplicateMedia(ref)` in lib/api/media.ts: a difference hash (9x8 grey,
  `.rotate()` first) over every image in every day's gallery, grouped at a
  Hamming distance the module names. Videos are skipped — a poster frame is not
  the video.
- `GET /api/v1/<user>/trips/<trip>/media/duplicates`, owner or a person on the
  trip, answering groups of `{ src, day, width, height, bytes }` largest first,
  so the caller can hand the smaller one straight to `DELETE .../media`.
- It reports; it never deletes. Which of two copies a journal keeps is an
  editorial decision, and the second call is where a person says so.
- The contract: openapi.ts, and the media section of /agent.md.

Not doing: a cross-trip or whole-journal sweep, and any automatic removal.

## Acceptance

- `GET /api/v1/severin/trips/algarve-2026/media/duplicates` names the eleven
  low-resolution copies, paired with the camera file each repeats, and does not
  pair `roadtrip-an-die-costa-vicentina/03` with `07` (a near-miss at distance
  10 — different photographs of the same sunset).
- A test with two renderings of one image, one of them EXIF-rotated, groups
  them; two different images do not group.
- `npm run verify` clean.
