---
id: B1245
title: There is no way to start a fresh conversation from WhatsApp, and no topic-shift question
type: FEATURE
priority: high
complexity: medium
area: whatsapp, helper, ux
found: "2026-09-10T08:48:08Z"
---

# B1245 — There is no way to start a fresh conversation from WhatsApp, and no topic-shift question

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

One WhatsApp thread lives 24h; a person who starts talking about something
else — or sends photos much later — is silently glued to the old
conversation. There is no way to start fresh from the chat, and the model
never asks whether a new topic belongs to the old thread.

## Work

Two halves. Mechanical: an exact-match command (de "neues gespräch", en "new
chat", hu equivalent — locale-sourced like wa.yes) matched BEFORE the model,
which ends the live session and starts a clean one, confirmed in one
sentence. Prompt: when the thread has been quiet for hours and the new
message reads as a different topic, the model asks in one line whether this
still belongs to the earlier subject or should start fresh — and a fresh
answer makes it call nothing from the stale context. Session boundaries stay
visible in /agent history as separate conversations.

## Acceptance

Sending the command starts a demonstrably new session (different id, empty
thread) with a one-line confirmation; the prompt carries the topic-shift
question; old conversations remain reachable at /agent.
