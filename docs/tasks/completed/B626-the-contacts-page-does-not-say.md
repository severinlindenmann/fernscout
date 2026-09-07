---
id: B626
title: The contacts page does not say who has the app installed and notifications on
type: FEATURE
priority: medium
complexity: low
area: contacts page, push
found: "2026-09-06T17:51:42Z"
started: "2026-09-06T18:18:42Z"
merged: "2026-09-06T18:24:14Z"
completed: "2026-09-07T13:12:34Z"
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

## Already satisfied (found while starting this task)

This landed under B453, before this task was captured, and the trace below
confirms it fully covers the Work and Acceptance sections above. No code
changed.

- `lib/push.ts` `deviceCountByContact()` counts live rows from
  `listSubscriptions()` — one query for the whole journal, keyed by
  `contactId`. "Live" is simply "a row exists in `push_subscriptions`"; there
  is no separate expiry column.
- Wired into both places `AdminContact` is built:
  `app/[user]/contacts/page.tsx:84` (`pushOn ? deviceCountByContact(username) : {}`)
  and `app/api/contacts/admin/route.ts:135`
  (`isEnabled("push", username) ? await deviceCountByContact(username) : null`),
  onto the `pushDevices: number | null` field.
- Rendered in `components/ContactsAdmin.tsx:381-391`: absent when push is off
  for the journal (`null`), "on no device yet" (greyed, `text-navy-500`) for
  zero, "on one device" / "on N devices" otherwise. Only a count is shown —
  no endpoint, user agent or device name reaches this component at all
  (`AdminContact.pushDevices` is a `number`, nothing else).
- `test/contact-push-devices.test.tsx` (6 tests, all passing on this branch)
  pins exactly this: zero vs one vs many vs null, and that the raw consent
  sentence is gone in favour of the two-word channel tags.
- Unsubscribing genuinely clears it: `components/PushOptIn.tsx` calls
  `DELETE /api/push/subscribe`, which calls `removeSubscription()`
  (`lib/push.ts:32`) → `pushRepo().remove()` → `lib/repos/pushDb.ts:73`, a real
  `deleteFrom("push_subscriptions")`. The row is gone, not marked, so the next
  `deviceCountByContact()` read no longer counts it.

Verified with `npx vitest run test/contact-push-devices.test.tsx` (6/6 pass)
and `npm run verify` (full pipeline, clean). Nothing to build — leaving the
lane move to whoever reviews this.
