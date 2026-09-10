---
id: B1271
title: A failed voice-note download also says nothing
type: ISSUE
priority: low
complexity: low
area: whatsapp
found: "2026-09-10T10:11:52Z"
---

# B1271 — A failed voice-note download also says nothing

## Why

`lib/whatsapp/dispatch.ts`'s `handleVoiceNote` (~364-370) has the identical
shape B1263 fixed for `handleMedia`: `downloadMedia` failing is caught with
`console.error` and the function returns, so a person whose voice note
failed to download gets no reply at all. Found while building B1263, which
scoped to `handleMedia` only per its ticket text.

## Work

Reply with one honest sentence (`wa.mediaDownloadFailed`, added by B1263,
reusable here) before returning from the catch block.

## Acceptance

A rejected `downloadMedia` on a voice note produces a non-empty reply,
mirroring `test/whatsapp-media.test.ts`'s "a media download that fails".
