---
id: B1244
title: The helper never asks for what a day is missing — time, place, costs
type: FEATURE
priority: medium
complexity: medium
area: whatsapp, helper, ux
found: "2026-09-10T08:48:08Z"
merged: "2026-09-10T09:20:06Z"
completed: "2026-09-10T15:12:38Z"
---

# B1244 — The helper never asks for what a day is missing — time, place, costs

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

A day drafted over WhatsApp ends the flow silently; the helper never asks for
what the day still lacks — when it happened, where (a location pin), what it
cost, who was there. The owner asked for gentle enrichment prompts.

## Work

Prompt guidance, not machinery: after a day is created or media attached, the
model asks ONE short follow-up for the most useful missing fact (place pin if
no coordinates, costs if none, times if none), never a questionnaire. Keep
the system-prompt addition short — the prompt budget is the scarce resource
(AGENTS.md). Weather stays the server's job and is never asked for.

## Acceptance

A drafted day with no coordinates is followed by a single question inviting a
location pin (test on the prompt text / a mocked turn), and a day that has
everything gets no nagging.
