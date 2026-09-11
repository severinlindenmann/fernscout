---
id: B1383
title: Microphone stays held after leaving the page
type: ISSUE
priority: high
complexity: medium
area: agent helper
found: "2026-09-10T19:12:23Z"
started: "2026-09-10T19:15:36Z"
merged: "2026-09-10T19:34:28Z"
---

# B1383 — Microphone stays held after leaving the page

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Findings and fix (2026-09-10, branch agent-mobile-fixes)

Root cause: tracks only stopped in MediaRecorder.onstop, never on unmount/pagehide/visibility-hidden or the getUserMedia-in-flight race. RecordButton now hard-releases the stream (and closes the AudioContext) on all of those paths.
