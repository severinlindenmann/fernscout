---
id: B695
title: A public GET spawns ffmpeg: /api/health and /agent.md turn a cheap request into processes
type: SECURITY
priority: high
complexity: low
area: api, health
found: "2026-09-07T10:13:11Z"
started: "2026-09-07T10:13:38Z"
session: d7d9b2c7-a675-4d23-9205-0830bbf3e059
claimed: "2026-09-07T10:13:38Z"
---

# B695 — A public GET spawns ffmpeg: /api/health and /agent.md turn a cheap request into processes

## Why

Found by a review of B692, which introduced it the same afternoon.

`videoToolsAvailable()` (lib/ingest/video.ts) answers by spawning `ffmpeg
-version` and `ffprobe -version`, each bounded at five seconds and each retried
once — so up to four spawns and ten seconds per call. It caches only a
**conclusive** answer, deliberately: an inconclusive check must not turn
video off for the life of the process. The consequence is that on a machine
where the check is inconclusive, every call spawns again.

B692 called it from `/api/health`, twice per request, and from `/agent.md`.
Both are public, unauthenticated, and documented as the first thing an agent
reads. So an unauthenticated GET became two to four process spawns and up to
twenty seconds of held request — and the condition that makes the check
inconclusive is *load*, which is the condition an attacker is creating. It
compounds: the busier the machine, the more spawns each request buys.

Before B692 neither document spawned anything.

## Work

- `videoToolsKnown()`: the cached answer or `null`, never a spawn. Both public
  documents read that.
- `register()` asks the spawning question once at boot, so the answer is there
  before any request. The case that matters — the binary is simply not
  installed — answers `ENOENT` immediately and is cached; only a loaded machine
  is inconclusive, and that is the one that must not be asked again.
- `null` reports the formats rather than refusing them: "nobody has asked yet"
  is not "this server has no ffmpeg", and `storeUploads` still refuses cleanly.
- Not doing: caching the inconclusive answer. That is the bug B692's own
  constant warns about, and the upload path is right to keep asking — it is
  authenticated, it is about to spend far longer transcoding, and its caller
  has asked for exactly this.

## Acceptance

- Five `GET /api/health` and five `agentGuide()` in a row, on a `PATH` whose
  ffmpeg is a shim that records being run, leave no trace — and the same shim
  does record one when `videoToolsAvailable()` is called, so the test is about
  the callers rather than a broken fixture.
- With nothing known, `/api/health` still lists the video formats.
