---
id: B1060
title: A voice note sent over WhatsApp has no route to the transcriber that already exists
type: FEATURE
priority: medium
complexity: low
area: whatsapp, speech, transcription
found: "2026-09-09T07:11:43Z"
---

# B1060 — A voice note sent over WhatsApp has no route to the transcriber that already exists

## Why

This one is nearly free and should be said so plainly, because it is the
feature the whole channel is worth having for: somebody at the end of a day,
tired, holds the button and talks for forty seconds.

`lib/helper/transcribe.ts` already does the work — Deepgram Nova-3,
pre-recorded, the language passed explicitly and never auto-detected (the file
says at length why: auto-detect mishandles Swiss German and Hungarian).
`app/api/helper/[user]/transcribe/route.ts` already spends credits by the
second, refunds a failed call, reconciles against the provider's own measured
duration, and asserts in a test that **no audio is ever written to disk**.

A WhatsApp voice note is `audio/ogg; codecs=opus`, which is already in the
accepted types. So what is missing is a caller, not a capability.

Three things are genuinely different and are the ticket:

- **Consent.** `speech` is its own scope in `lib/helper/consent.ts` because it
  names a second provider. Somebody who has never opened `/agent` has agreed
  to nothing, and the first voice note is where they have to be asked — in
  chat, before the audio goes anywhere.
- **Credits.** `creditsForSeconds` charges by the second. Sixteen megabytes of
  Opus is a long recording. The refusal when a balance runs out has to be a
  sentence, not a failure.
- **Length.** The route caps at 900 seconds; Meta caps inbound audio at 16 MB.
  Whichever bites first, the person hears about it in their own language.

## Work

- Fetch the audio by media id, hand the bytes to `transcribeAudio()`, drop
  them. Nothing lands on disk — the existing test asserting that must cover
  this path too, or it is a promise that quietly stopped being true.
- Ask for `speech` consent in the conversation on first use, and record it the
  same way `/agent` does. Do not assume the web consent covers it and do not
  invent a second consent store.
- Feed the transcript in as an ordinary `said`, exactly as the web room does —
  it is not a special input type.
- Echo the transcript back before acting on it. A misheard place name that
  becomes a day is worse than one extra message.

## Acceptance

A voice note sent to the number becomes a transcript in the conversation, the
audio is provably not on disk afterwards, and somebody who has not agreed to
`speech` is asked before any of it leaves the machine.
