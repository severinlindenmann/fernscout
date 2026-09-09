---
id: B1195
title: A refused exchange vanishes from the stored conversation the person saw
type: ISSUE
priority: high
complexity: low
area: helper
found: "2026-09-09T22:34:27Z"
started: "2026-09-09T22:35:04Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-09T22:35:04Z"
---

# B1195 — A refused exchange vanishes from the stored conversation the person saw

## Why

Persona round (Elena, live site, 2026-09-10): she sent 7 messages, the
history panel counted 6 turns, and reopening the conversation drew a
transcript missing one full exchange she had seen answered — her
"remove the day" message and its (correct, documented) refusal. B817's
gate refuses removal language before the model and deliberately does not
`remember()` it into the thread — right for the model — but the ask route
also never `recordTurn()`s it, so the person's own stored history lies by
omission. Confirmed three times in the round.

## Work

In the ask route's refusal path (the intents gate), record the exchange to
`helper_sessions` — the person's words and the refusal sentence they were
shown — without adding it to the model thread. The words are their own
history (lib/helper/sessions.ts's stated rule); which sentences the model
re-reads is a separate decision that stands.

## Acceptance

A gated sentence and its refusal appear in the reopened conversation and
count as a turn in the history panel; the model thread still never carries
the removal language (existing B817 tests unchanged).
