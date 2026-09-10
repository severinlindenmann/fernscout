---
id: B1382
title: WhatsApp channel dead on live and switching agent to whatsapp breaks the session
type: ISSUE
priority: high
complexity: high
area: whatsapp
found: "2026-09-10T19:12:23Z"
started: "2026-09-10T19:15:36Z"
merged: "2026-09-10T19:34:28Z"
---

# B1382 — WhatsApp channel dead on live and switching agent to whatsapp breaks the session

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Findings and fix (2026-09-10, branch agent-mobile-fixes)

Root cause found in the live logs: the inbound webhook matched the number to the severin journal and dropped every message with "has not opted into the channel — no reply". The journal was created on the web and the number proven via WhatsApp (telProvenMethod whatsapp-inbound), but only the WhatsApp-onboarding path ever set whatsappInbound: true; the web signup path never did. That same flag also gates the wa.me chip on /agent, which is why switching from the helper to WhatsApp offered nothing.

Fixes: (1) app/api/v1/journals/route.ts now switches whatsappInbound on when the number was proven via whatsapp-inbound, the same consent reading as lib/whatsapp/onboarding.ts; (2) the silent drop in lib/whatsapp/dispatch.ts now answers once per number (toldOnce, wa.channelOff) naming /agent, then stays quiet.

Still open: the existing severin journal needs the flag set by hand on the VPS (agent was permission-blocked from editing live config); there is no owner-facing toggle for whatsappInbound at all (separate capture); "refreshing /agent broke everything" not yet reproduced — retest after deploy.
