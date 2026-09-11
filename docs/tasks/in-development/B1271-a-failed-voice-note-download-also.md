---
id: B1271
title: A failed voice-note download also says nothing
type: ISSUE
priority: low
complexity: low
area: whatsapp
found: "2026-09-10T10:11:52Z"
started: "2026-09-11T08:26:10Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T08:26:10Z"
---

# B1271 — A failed voice-note download also says nothing

## Why

VALID, confirmed 2026-09-11: `lib/whatsapp/dispatch.ts`'s `handleVoiceNote`
(catch block at ~448-452, at time of reading) has the identical shape B1263
fixed for `handleMedia`: `downloadMedia` failing is caught with
`console.error` and the function returns, so a person whose voice note
failed to download gets no reply at all. Found while building B1263, which
scoped to `handleMedia` only per its ticket text.

Two siblings found while building this: the transcription-failure branch
three lines below (B1430) and the much larger `answerOnWhatsapp` catch
around a failed model turn on every ordinary text reply (B1431). Both
captured rather than fixed here, per this ticket's own instruction to follow
B1263's discipline.

## Work

Reply with one honest sentence (`wa.mediaDownloadFailed`, added by B1263,
reusable here) before returning from the catch block.

## Acceptance

A rejected `downloadMedia` on a voice note produces a non-empty reply,
mirroring `test/whatsapp-media.test.ts`'s "a media download that fails" —
done as a new "a voice-note download that fails" describe block in that same
file, per the ticket's `Touches` line.
