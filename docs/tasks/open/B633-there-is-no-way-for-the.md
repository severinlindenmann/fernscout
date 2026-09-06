---
id: B633
title: There is no way for the owner to send a day's notification from the day itself
type: FEATURE
priority: medium
complexity: medium
area: day page, digest, credits
found: "2026-09-06T17:51:45Z"
---

# B633 — There is no way for the owner to send a day's notification from the day itself

## Why

Sending a day to the people following a trip already exists — `sendDayLetter`
and `sendDayWhatsapp` in `lib/digest/`, behind
`POST …/days/<slug>/send-mail` and `…/send-whatsapp`, with a cost estimator
(`lib/digest/dayWhatsapp.ts:192`) that answers what a send would take without
sending. What does not exist is a way for the owner to do it while looking at
the day. So the one person entitled to decide has to ask an agent, and cannot
see whether it has already gone out.

## Work

- On a day, to the owner only, a button that sends the notification.
- Before it sends, say what it will cost in credits and what the balance is —
  the estimator already answers both. Not enough credits: say so, and say where
  to top up, rather than failing at the send.
- Record that a day has been sent, and show that instead of the button. An
  owner must not have to remember; a second send to the same people is the
  failure this prevents.
- A cookie session only, like the postcard send button — a bearer token must
  not be able to press it.

## Acceptance

- As the owner, a day that has not been notified shows the button; pressing it
  asks for confirmation naming the credit cost and the balance, and sends.
- The same day afterwards says it has been sent, and offers no second button.
- With too few credits, the confirmation says so and nothing is spent.
