---
id: B1430
title: A failed transcription says nothing, on the WhatsApp voice-note path
type: ISSUE
priority: low
complexity: low
area: whatsapp
found: "2026-09-11T08:29:49Z"
---

# B1430 — A failed transcription says nothing, on the WhatsApp voice-note path

## Why

`lib/whatsapp/dispatch.ts`'s `handleVoiceNote` calls `spendAndTranscribe`
(~469-478) and, when it fails for any reason other than `no_credits`, does
this:

```ts
} else {
  console.error(`[whatsapp:inbound] transcription failed for ${username}`);
}
return;
```

No reply is sent. A sender whose voice note downloaded fine but failed to
transcribe (Deepgram unreachable, an unsupported codec, whatever
`spendAndTranscribe` can throw internally) gets silence — the same "is it
still typing?" confusion B1263 fixed for a failed download and B1271 just
fixed for a failed voice-note download, one branch further down the same
function.

Found while building B1271, which scoped to the download-failure branch only
per its own ticket text.

## Work

Reply with one honest sentence before returning from the `else` branch —
likely a new locale string (`wa.transcriptionFailed` or similar; check
whether an existing string already says this for the web helper's own
transcription-failure path and reuse it rather than inventing a second one).

## Acceptance

A `spendAndTranscribe` outcome with `ok: false` and an error other than
`no_credits` produces a non-empty reply to the sender, with a test alongside
`test/whatsapp-voice.test.ts`'s existing no-credits case.
