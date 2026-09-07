---
id: B670
title: kept in the media upload response omits the video originals it stored
type: ISSUE
priority: low
complexity: low
area: media API
found: "2026-09-07T08:38:57Z"
merged: "2026-09-07T08:53:40Z"
completed: "2026-09-07T13:13:30Z"
---

# B670 — kept in the media upload response omits the video originals it stored

## Why

`POST /api/v1/<user>/trips/<trip>/media` answers with `kept`, and its own note
calls it "what was stored untouched for print". For a video that is false by
omission: `lib/api/media.ts` stages the original of every upload — the video
branch pushes it onto `staged` like any image — but pushes onto `originals`
only in the image branch, and `continue`s before it. So a batch of three
photographs and two clips answers with three `kept` entries while five
originals are on disk.

Verified locally: `content/<user>/trips/<trip>/originals/<day>/04.mov` (25 MB)
exists and no `kept` row names it.

It is the failure AGENTS.md names — a field the document promises and the code
drops. An agent reading `kept` to check its own work concludes the clip's
original was thrown away, and the honest reading of that is to upload again.

## Work

Push a `KeptOriginal` in the video branch too. Its `width`/`height` come from
the probe that has already run; if a `KeptOriginal` cannot honestly carry
dimensions for a video, say so in the type rather than leaving the row out.

## Acceptance

- A multipart upload of one image and one clip answers with two `kept` entries,
  the second naming the clip's original filename and its byte count.
- A test in `test/` covering it.
