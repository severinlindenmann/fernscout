---
id: B686
title: Speech cannot be turned into text
type: FEATURE
priority: low
complexity: medium
area: agent, capabilities
found: "2026-09-07T09:53:00Z"
---

# B686 — Speech cannot be turned into text

## Why

Plan §6. The phone is where the traveller is, and talking is faster than typing
on a bus. The OS keyboard has a microphone, but it is inconsistent across
platforms and stops at the field; a record button that works the same
everywhere makes speech the way to drive the whole product, including the
router box (B685).

## Work

- A `transcription` capability, off by default, with a **`dry-run` backend that
  returns a canned transcript** so the flow develops with no account anywhere —
  the promise mail and the print providers already keep.
- One real backend speaking the Whisper HTTP shape, so a self-hoster can point
  at their own server with no new code.
- `POST /api/helper/transcribe`, cookie only, metered per started minute with
  the price shown before the hold.
- **Audio is transcribed and discarded.** The transcript goes into the draft;
  nothing is kept under `contentRoot()` or anywhere else.

## Acceptance

With the backend on `dry-run`, holding the button produces the canned
transcript and charges nothing that a test cannot assert; with a real backend a
spoken sentence reaches the draft, the ledger shows the minutes, and no audio
file exists on disk afterwards.
