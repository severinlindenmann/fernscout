---
id: B1027
title: The send button is offered on a day whose journal has no readers to send it to
type: ISSUE
priority: low
complexity: low
area: components/DayNotify.tsx
found: "2026-09-08T22:05:00Z"
started: "2026-09-09T06:09:48Z"
merged: "2026-09-09T07:06:25Z"
completed: "2026-09-09T16:46:08Z"
---

# B1027 — The send button is offered on a day whose journal has no readers to send it to

## Why

`reachable` asks whether any channel is *configured* for the journal, not
whether anybody is on it. A journal with mail switched on and no approved,
opted-in contacts is `reachable: true` with a count of zero, so the tile is
drawn, the confirmation opens, and pressing it sends to nobody and reports
success.

Noticed while building B1024, which is what made it visible: the panel now
knows the counts, so it can tell "nobody" from "somebody" for the first time.
B1024 draws no row for a channel with a count of zero, which is right for the
list but leaves the all-zero case as a question with nothing under it.

It is not a new fault — the button has always been offered here — and it is
low because the failure is a wasted press rather than a wrong send.

## Work

With every count at zero, say so instead of asking: one sentence naming that
this journal has no readers signed up yet, and the way to invite one is the
tile already sitting beside it. Either that, or draw no tile at all — decide
which by whether the owner should learn the fact or simply not be offered the
control.

## Acceptance

A journal with a channel configured and nobody subscribed does not offer a
send that would reach nobody, or says plainly that it would.
