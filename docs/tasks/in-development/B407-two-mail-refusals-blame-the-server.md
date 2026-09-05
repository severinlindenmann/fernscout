---
id: B407
title: Two mail refusals blame the server when it is the journal's own switch that is off
type: ISSUE
priority: low
complexity: low
area: mail
found: "2026-09-05T07:49:39Z"
started: "2026-09-05T08:49:34Z"
session: 62683d95-33a6-4db0-a254-7a8fcbcf014e
claimed: "2026-09-05T08:49:34Z"
---

# B407 — Two mail refusals blame the server when it is the journal's own switch that is off

## Why

Two refusals name the wrong layer. Both were produced on fernscout.ch
2026-09-05 by switching **one journal's** `features.mail` off, while the
server's own mail capability stayed on and working:

`POST /api/contacts/redeem`:
> "**This server cannot send** the six-digit code that redeeming a link
> needs ... The person who runs this server has to turn mail on; /api/health
> says why it is off."

`POST /api/v1/<user>/invites` with an `email`:
> "Could not send to ... — **this server's mail may be off.** The link above
> still works and that address is still pre-approved; send it another way."

The server's mail was on in both cases. `/api/health` would have said so, which
makes the first message's own advice a dead end: an owner who follows it looks
at a healthy server and learns nothing. The switch that is actually off is the
one in their journal's `config.json`, which they can change themselves through
`PATCH /api/v1/<user>/config`.

`sendMail` already distinguishes the two — `isEnabled("mail")` for the server,
`hasSwitchedOff("mail", username)` for the journal — so the information exists
at the point the message is written.

## Work

Say which switch is off, and point at the one that can be changed. Keep the
server wording for the server case.

## Acceptance

With a journal's mail off and the server's on, neither refusal blames the
server, and both name the journal's own switch.
