---
id: B1552
title: Email code endpoints have per-IP limits only — no per-recipient or per-instance cap
type: SECURITY
priority: high
complexity: low
area: auth/mail
found: "2026-09-11T23:06:54Z"
started: "2026-09-12T07:22:48Z"
session: 5c987a64-dfc0-4ac9-9b57-3804213ba1b8
claimed: "2026-09-12T07:22:48Z"
---

# B1552 — Email code endpoints have per-IP limits only — no per-recipient or per-instance cap

## Why

`app/api/auth/request/route.ts:109-119` (10 guest / 5 agent per IP per 15 min),
`app/api/auth/identity/request/route.ts:53-56` and
`app/api/auth/signup/request/route.ts:38-41` (5/hour per IP) throttle by
`clientIp` only. The WhatsApp channel already has the missing controls —
per-number (10/day) and per-instance (100/day) buckets at
`auth/request/route.ts:251-254`, with a comment noting the per-IP bucket is no
ceiling against a distributed caller — but the email channel got neither. A
botnet or IPv6 /64 rotation can mail codes to an arbitrary victim address
without bound, spending the operator's SMTP quota and burning the sending
domain's reputation — the same domain the deletion and approval mails depend
on.

## Work

- Mirror the WhatsApp pattern: a per-recipient-address bucket and a
  per-instance daily email ceiling on all three code-request routes.
- Not doing: CAPTCHA or changes to the uniform-202 enumeration behaviour.

## Acceptance

A test looping code requests for one address from varying IPs is refused after
the per-address cap; a second test shows the instance-wide daily ceiling
holding. Ordinary sign-in (a handful of codes per day) is unaffected.
