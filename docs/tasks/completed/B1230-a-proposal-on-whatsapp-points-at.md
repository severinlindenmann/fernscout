---
id: B1230
title: A proposal on WhatsApp points at a screen instead of offering its own button
type: FEATURE
priority: high
complexity: medium
area: whatsapp, helper, proposals
found: "2026-09-10T05:25:02Z"
merged: "2026-09-10T05:46:58Z"
completed: "2026-09-10T15:12:33Z"
---

# B1230 — A proposal on WhatsApp points at a screen instead of offering its own button

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Live on 2026-09-10: the owner asked for a new trip over WhatsApp, the model
proposed it, and the reply said "Ein Vorschlag liegt auf deinem Bildschirm …
Drücke den Button" with a link to /agent — no button exists in the chat, and
the write routes are cookie-only, so a tap could not have worked anyway.
The proposal machinery bypasses the Block renderer (the web room draws its
own panel), so B1056's confirm-buttons never fire for the most common write.

## Decided — 2026-09-10, by the owner

Confirming an ordinary journal write (trip, day, and the like) must work
directly in WhatsApp: the proposal gets real reply buttons, and the accept
tap executes the same write the web panel's button executes, authenticated by
the number binding. Money and irreversible flows (postcards, photobooks,
credits, deletion) stay behind the web, unchanged.

## Acceptance

Proposing a trip over WhatsApp yields a message with an accept and a decline
button; tapping accept creates the trip and says so; tapping decline discards
it; nothing is written without a tap. Proven by signed-webhook tests.
