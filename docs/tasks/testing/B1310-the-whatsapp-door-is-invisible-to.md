---
id: B1310
title: The WhatsApp door is invisible to anyone not already in their room
type: FEATURE
priority: high
complexity: low
area: whatsapp, landing, agent
found: "2026-09-10T15:12:51Z"
merged: "2026-09-10T15:33:52Z"
---

# B1310 — The WhatsApp door is invisible to anyone not already in their room

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

B1127 placed the wa.me chip only in the owner's room, gated on a proven
number. The owner decided on 2026-09-10 that the channel should be
discoverable before that: on the landing page beside "Start writing" ("or
start using WhatsApp"), and on /agent's door with a short line. Anonymous
pages cannot know a visitor's number state, so these render whenever the
instance itself has a display number configured (whatsappDisplayNumber()),
and the channel explains itself to strangers already (wa.strangerReply).

## Acceptance

fernscout.ch/ shows a WhatsApp entry beside the start-writing action, /agent
shows a short one, both only when the instance has a number configured, both
localized en/de/hu, checked in a browser at 1280 and 390.
