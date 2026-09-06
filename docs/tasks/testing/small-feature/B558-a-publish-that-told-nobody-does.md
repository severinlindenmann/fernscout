---
id: B558
title: A publish that told nobody does not say so — the response should prompt the ask about mail and WhatsApp
type: FEATURE
priority: medium
complexity: low
area: api, agent guide
found: "2026-09-06T09:38:57Z"
merged: "2026-09-06T09:43:09Z"
---

# B558 — A publish that told nobody does not say so — the response should prompt the ask about mail and WhatsApp

## Why

`POST .../days/<slug>/publish` with an empty body puts the day on the site and
tells nobody it is there — the readers hear about it at the next scheduled
digest, if there is one. Both channels exist (`send_mail`, `send_whatsapp`, and
the two resend routes) and `/agent.md` describes them, but the response an agent
actually reads after a publish says nothing about them, so the ask usually never
happens. The default must stay "send nothing" — fifteen publishes must not mail
fifteen letters — which is exactly why the prompt has to come back in the
receipt instead.

## Work

- `app/api/v1/[user]/trips/[trip]/days/[slug]/publish/route.ts`: when neither
  flag was requested, carry a `notify` block naming the channels this journal
  can actually use (`isEnabled("mail"|"whatsapp", user)`), the follow-up route
  for each, and one sentence telling the agent to ask in words. Absent when a
  channel is off, and absent entirely for a `test: true` day, which sends
  nothing whatever the flag says.
- `lib/api/documentation.ts`: one paragraph in the publish section so the guide
  and the receipt say the same thing.
- Not doing: any change to the defaults, to the flags, or to who may send.

## Acceptance

A publish with `{}` on a journal with mail on answers with
`notify.channels` containing `mail` and a `send-mail` URL; a publish with
`{"send_mail": true}` carries no `notify`; a `test: true` day carries none
either. Covered in `test/day-mail.test.ts`.
