---
id: B1404
title: A matched number with the channel off gets silence instead of a fresh opt-in ask
type: ISSUE
priority: high
complexity: medium
area: whatsapp
found: "2026-09-10T19:41:01Z"
started: "2026-09-11T08:26:09Z"
merged: "2026-09-11T09:00:30Z"
---

# B1404 — A matched number with the channel off gets silence instead of a fresh opt-in ask

## Why

VALID, confirmed 2026-09-11. Built as CHOSEN A per the plan-a-run brief and
`.claude/runs/2026-09-10-agent-room/B1404/option-a.html`: "yes" flips
`whatsappInbound` on for the journal, right on that reply.

`lib/whatsapp/dispatch.ts` (the `!isEnabled("whatsappInbound", username)`
branch, ~line 177): when an inbound message matches a journal whose
`whatsappInbound` is off, the server drops it. Since B1382 it says one
sentence, once per number, pointing at `/agent` — better than the old
silence, but still a dead end on the phone the person is holding.

The owner hit this for real: they deleted their journal and made a new one,
and the new journal has the flag off (B1382's create-time fix only covers a
journal whose number was proven via `whatsapp-inbound` in that signup — a
recreated journal, or one whose number was proven by SMS, starts with the
channel off). Their WhatsApp thread with the instance simply stopped working,
and the one reply sends them to a browser to do something there is not even a
switch for (B1388).

The person is *in the chat*, from the *proven number of the journal's owner*.
That is exactly where consent can be asked and answered — the onboarding flow
(`lib/whatsapp/onboarding.ts`) already does conversational yes/no, and the
speech-consent ask (`lib/whatsapp/speechConsent.ts`) is the same shape one
level down.

## Work

- In the channel-off branch, when the sender's number is the journal owner's
  own proven `tel`: instead of the B1382 one-liner, ask for opt-in in the
  chat — one message explaining what switching it on means, answered with
  yes/no (reuse the `wa.yes` vocabulary / button shape the consent flows
  already use).
- A "yes" from that number calls `setJournalFeatures(username,
  { whatsappInbound: true })` and then processes normally (or asks them to
  resend); a "no" (or no answer) marks told-once and goes quiet as today.
- Only for the owner's proven number. Anybody else on the trip keeps the
  current pointer-to-/agent behaviour — a buddy must not be able to switch a
  journal capability on.
- Pending-ask state per number, same pattern as `speechConsent.ts` /
  `toldOnce.ts`.
- Not in scope: the owner-facing web switch (B1388), and any change to the
  `whatsapp` announcements capability, which stays off.

## Acceptance

- With `whatsappInbound` off, a WhatsApp message from the owner's proven
  number gets an opt-in question, not silence and not only a link.
- Replying yes turns the capability on (visible in the journal's
  `config.json`) and the next message is answered normally.
- Replying no leaves it off and the channel quiet afterwards.
- A message from a non-owner number on the same journal still gets the
  told-once pointer, and cannot flip the flag.
