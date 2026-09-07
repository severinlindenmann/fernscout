---
id: B669
title: Video is served without Range support, so a clip cannot be scrubbed
type: ISSUE
priority: high
complexity: low
area: media serving
found: "2026-09-07T08:38:56Z"
merged: "2026-09-07T08:53:40Z"
completed: "2026-09-07T13:13:28Z"
---

# B669 — Video is served without Range support, so a clip cannot be scrubbed

## Why

`app/[user]/media/[...path]/route.ts` reads the file and answers `200` with the
whole body, whatever the request asked for. There is no `Accept-Ranges`, and a
`Range:` header is ignored — verified locally against a 22s clip uploaded
through `POST /api/v1/<user>/trips/<trip>/media`:

```
curl -r 0-99 .../media-upload-check/04.mp4
HTTP/1.1 200 OK
content-length: 14084195
content-type: video/mp4
```

Two costs. A reader who drags the scrubber past what has downloaded is snapped
back: in Chromium, setting `currentTime = 20` on a 30s clip returned to 2.4s
and carried on. And Safari — iOS included, which is most of the readers this
software is for — sends `Range: bytes=0-1` before it will play a `video/mp4`
at all and treats a `200` as unplayable; that half was not verified here, but
it is the documented behaviour and it is the same route.

The route was written for
photographs, where reading the whole file is the right answer; video came through
the same door later.

## Work

Handle `Range` in the media route for every file it serves: parse the single
`bytes=start-end` form, answer `206` with `Content-Range` and a stream of that
slice, `416` on an unsatisfiable one, and set `Accept-Ranges: bytes` on the
plain `200` too. Not doing: multipart ranges, which no browser sends for media.

The gate is unchanged — the range is decided after `readFor`, never before.

## Acceptance

- `curl -r 0-99 <a clip's URL>` answers `206` with `content-range: bytes 0-99/<size>`
  and 100 bytes.
- On a day page, seeking a clip to near its end lands there and plays.
- A test in `test/` asserting the 206, the `Content-Range` and a 416.
