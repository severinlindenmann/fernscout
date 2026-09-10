---
id: B1213
title: Room decisions: honest streaming status lines while the model works (D19)
type: FEATURE
priority: high
complexity: high
area: helper room
found: "2026-09-10T04:39:37Z"
started: "2026-09-10T06:24:04Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-10T06:24:04Z"
---

# B1213 — Room decisions: honest streaming status lines while the model works (D19)

## Why

Owner's decision round of 2026-09-10 (see docs/plans/2026-09-10-room-decisions.md for the full list): D19 A. Up to twenty seconds of three bouncing
dots while the model works. The server knows which tools are running; the
person should read real progress — "liest den Tag…", "schreibt den
Vorschlag…" — as it happens, with the answer still arriving whole.

## Work

The ask route streams status events (SSE or chunked NDJSON) emitted at
tool start from the model loop; HelperAsk consumes them into the waiting
area. Fall back silently to the current behaviour when streaming is
unavailable. No change to what is recorded or charged.

## Acceptance

On the live site a multi-tool turn shows at least two distinct status
lines before the answer; a network that buffers still gets the answer
(fallback proven by disabling streaming).
