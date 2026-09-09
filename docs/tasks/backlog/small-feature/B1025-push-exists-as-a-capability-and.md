---
id: B1025
title: Push exists as a capability and is not a channel this day can be sent on
type: FEATURE
priority: low
complexity: medium
area: lib/digest/dayNotify.ts
found: "2026-09-08T21:41:00Z"
---

# B1025 — Push exists as a capability and is not a channel this day can be sent on

## Why

`lib/capabilities.ts:34` carries `push`, with `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`, and the demo journal switches it on.
`lib/digest/dayNotify.ts:6` says `type NotifyChannel = "mail" | "whatsapp"`.
So the instance can send a web push and the day-notify button cannot ask it
to — a capability that is configured, enabled, and reaches nothing.

Noticed while designing B1024, where the obvious third row of the recipient
list turned out to have nothing behind it.

## Work

A third channel is not a display change. It needs the same four parts the
other two have: who the recipients are (subscriptions, not addresses), what
the reader consented to (a `wantsPush` beside `wantsEmailDigest` and
`wantsWhatsapp`), the once-only claim so a day is not pushed twice
(`claimChannel` already takes a channel), and what it costs — which for push
is nothing, so it joins mail on the free side of B1024's list.

The visibility narrowing is the part to get right rather than to copy: both
existing channels filter recipients through `maySeePhoto(entry.visibility,
r.reader)`, and a push subscription has no reader level attached to it today.
Work out where that comes from before writing any of the rest.

## Acceptance

- A day can be pushed, once, to readers who asked for it and are allowed to
  see it.
- It appears as a row in B1024's list with its own count.
- A journal with `push` off is unchanged in every respect.
