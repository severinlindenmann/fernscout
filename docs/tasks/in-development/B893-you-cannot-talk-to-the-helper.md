---
id: B893
title: You cannot talk to the helper, only type at it
type: FEATURE
priority: medium
complexity: medium
area: agent
found: "2026-09-07T18:29:59Z"
started: "2026-09-08T06:35:14Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-08T06:35:14Z"
---

# B893 — You cannot talk to the helper, only type at it

## Why

Round 4 of `docs/plans/2026-09-07-helper-as-an-agent.md`.

Speech already works — B686 put Deepgram behind a capability, with the language
taken from the journal rather than detected, and `de-CH` and `hu` proven live.
It reaches two places: the wizard's words step and the old ask box.

Once the helper is a conversation (B889, B891, B892), talking to it is the
natural way to use it — and it is the way the person this was built for would
prefer. A 19-year-old sends voice notes rather than messages. A 71-year-old
finds a keyboard harder than a sentence. A traveller on a bus has one hand.

## Work

The microphone in the conversation's field, so a turn can be spoken instead of
typed. The transcript becomes the message; the person can edit it before
sending, because a transcription is a guess and the words are theirs.

Reuse `components/RecordButton.tsx` as it is — B794 gave it a keyboard path and
a toggle, so it is already reachable without a mouse. Do not build a second
recorder.

The language select stays where B686 put it: inside the recording panel, after
speaking is chosen, defaulting to the journal's own language.

## Acceptance

A whole day can be written by talking, from the conversation, without typing —
and every word can still be corrected before it is kept.
