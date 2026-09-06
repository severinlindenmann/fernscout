---
id: B626
title: The contacts page does not say who has the app installed and notifications on
type: FEATURE
priority: medium
complexity: low
area: contacts page, push
found: "2026-09-06T17:51:42Z"
started: "2026-09-06T18:18:42Z"
session: e5f23c58-bb87-4175-ad7b-5d3aed93169f
claimed: "2026-09-06T18:18:42Z"
---

# B626 — The contacts page does not say who has the app installed and notifications on

## Why

`/<user>/contacts` is where the owner decides who gets what, and one thing they
cannot see there is whether a person will actually receive a push notification.
The subscription is known — `push_subscriptions` exists since
`lib/db/migrations/001-initial.ts:104`, and `components/PushOptIn.tsx` is what
writes a row — but the admin list does not read it. So the owner sends and
hopes, and cannot tell "declined notifications" from "never opened the link".

## Work

- Show, per contact row, whether that person has at least one live push
  subscription — a small marker, not a paragraph.
- Where a subscription exists it implies the app is installed; do not invent a
  separate "PWA installed" signal for a fact the subscription already carries.
- Do not show endpoints, user agents or device names. The owner needs to know
  a message will land, not what somebody is holding.

## Acceptance

- A contact with a push subscription is visibly distinguished from one without,
  on `/<user>/contacts`.
- Revoking the subscription (unsubscribing in the browser) clears the marker.
