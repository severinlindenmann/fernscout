---
id: B692
title: /api/health advertises video formats on a server that cannot take a clip
type: ISSUE
priority: high
complexity: low
area: api, health
found: "2026-09-07T10:00:34Z"
started: "2026-09-07T10:01:02Z"
merged: "2026-09-07T10:06:44Z"
---

# B692 — /api/health advertises video formats on a server that cannot take a clip

## Why

`app/api/health/route.ts:290` reports `media.videoFormats` from the constant,
always. On fernscout.ch, which had no ffmpeg until 2026-09-07, that told every
caller it accepted mp4, mov and webm while `storeUploads` refused each one with
"images only on this instance — ffmpeg and ffprobe are not installed".

That is the failure AGENTS.md names twice: an optional capability must be
*absent* rather than broken, and a limit belongs where a caller can read it
before they hit it. `/api/health` is the one document an agent reads to find
out what this server will take, so it is the one place this must not be
optimistic. Nothing else says it either — `/agent.md` prints the same row from
the same constants.

It went unnoticed for as long as it did because the refusal, when it finally
comes, is a good one. The cost is the two round trips and the upload before it.

## Work

- `videoFormats` is `[]` when `videoToolsAvailable()` says the tools are not
  there, with the reason beside it in the shape capabilities already use.
- `/agent.md`'s limits table says the same, since it is rendered per instance
  and per request like health is.
- Not doing: `/openapi.json`, which describes the API's shape rather than this
  server's — the same document has to be true on an instance that does have
  ffmpeg.

`videoToolsAvailable()` caches, and deliberately does not cache a check that
did not finish (test/video-tools.test.ts). Installing ffmpeg under a running
process therefore needs a restart before health tells the truth; say so.

## Acceptance

- On a machine with ffmpeg on `PATH`, `/api/health` is unchanged.
- With `PATH` emptied of it, `videoFormats` is `[]` and the reason names
  ffmpeg.
- A test for both.
