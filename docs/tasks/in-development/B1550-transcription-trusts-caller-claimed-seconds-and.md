---
id: B1550
title: Transcription trusts caller-claimed seconds and the top-up charge fails open
type: SECURITY
priority: high
complexity: low
area: helper/transcription
found: "2026-09-11T23:06:54Z"
started: "2026-09-12T07:22:46Z"
session: 5c987a64-dfc0-4ac9-9b57-3804213ba1b8
claimed: "2026-09-12T07:22:46Z"
---

# B1550 — Transcription trusts caller-claimed seconds and the top-up charge fails open

## Why

`app/api/helper/[user]/transcribe/route.ts:86-92` pre-charges from the
caller-asserted `body.seconds`, refusing only when it exceeds
`MAX_SPEECH_SECONDS` (900) — `0`, negative or absent all pass and are charged
the 0.01-credit floor (`creditsForSeconds`, `lib/helper/speech.ts:81-84`). The
only independent bound is `MAX_AUDIO_BYTES` = 16 MB (`speech.ts:67`), which at
8 kbit/s Opus is ~4.5 hours of audio. After the Deepgram call,
`lib/helper/transcribeSpend.ts:59-63` tries to charge the measured difference —
and when the balance cannot cover it, `spent` silently stays at the floor and
the full transcript is returned anyway.

Cost: a self-signup journal's 10-credit grant funds ~1,000 such calls ≈ 250
hours of Deepgram ≈ CHF 50–100 of operator spend per farmed identity, throttled
only by the 30/15-min per-IP limit. Found independently by two audit passes on
2026-09-12.

## Work

- Charge from `Math.max(claimed, measured)` and make the reconciliation fail
  closed: when the top-up `spend` is refused, do not return the transcript (or
  refund the floor and refuse).
- Refuse when Deepgram's measured `seconds > MAX_SPEECH_SECONDS`.
- Consider tightening `MAX_AUDIO_BYTES` toward the bitrate the recorder
  actually produces, or pre-authorising `creditsForSeconds(MAX_SPEECH_SECONDS)`
  when `claimed` is implausibly small for the byte size.
- Not doing: server-side duration probing before the provider call (would need
  an audio decoder; the measured-seconds fail-closed path covers the exposure).

## Acceptance

A test where the claimed seconds are 0, the (simulated) provider measures 600s,
and the balance holds only the floor: the caller gets a refusal, not a
transcript, and the balance is not left under-charged. Honest short recordings
still transcribe and charge the floor.
