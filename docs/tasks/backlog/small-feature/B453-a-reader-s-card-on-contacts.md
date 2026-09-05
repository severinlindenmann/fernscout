---
id: B453
title: A reader's card on /contacts is a wall of labels, and says nothing about notifications on their phone
type: FEATURE
priority: medium
complexity: low
area: contacts, push
found: "2026-09-05T12:47:44Z"
---

# B453 — A reader's card on /contacts is a wall of labels, and says nothing about notifications on their phone

## Why

Two things, one card — `ContactRow` in `components/ContactsAdmin.tsx:266`.

**It reads as a wall.** Everything about a person is one `<dl>` in one weight:
their language, how they arrived, when they were last here, what they want,
their home address and their phone number, each a label and a value in the same
grey. The three consent lines are the worst of it, because the owner-facing
strings are whole sentences and they are joined with a dot — *"Wants an email
when there are new days to read · Wants a real postcard from the road · Wants a
WhatsApp when a new day goes up"* — so the one genuinely scannable fact on the
card, which channels this person is on, is the least scannable thing on it.

**And it is missing the fourth channel.** Push exists, `push_subscriptions`
carries a `contactId` (set at subscribe time, `lib/push.ts#findActiveContactId`)
and `subscribersFor` already uses it to keep a closed trip's notification off
the wrong lock screen. None of that reaches this page: an owner looking at a
reader cannot tell whether they get anything on their phone, and the edit form
offers three tick boxes with no hint that a fourth channel exists at all.

It cannot *become* a fourth tick box, and that is the point worth writing down:
a subscription is made by the reader's own browser, on one device, behind a
permission prompt. An owner ticking a box could not create one. So it is
**state to be shown**, not consent to be collected — and on an iPhone it also
needs the site added to the Home Screen first, which is the one thing an owner
being asked "why don't I get anything" has to know.

## Work

- `lib/push.ts`: count active subscriptions per contact for a journal, once,
  from the read `listSubscriptions` already does.
- `AdminContact` carries the count; both places that shape it — the page and
  `ownerView` in `app/api/contacts/admin/route.ts` — fill it, so a refresh
  after an action does not drop it.
- `ContactRow`: the channels become a row of chips with icons, the rest stays a
  grid but with the label and the value told apart. Palette tokens only; see
  `apply-the-brand` on which greys are text.
- The push chip states what is true — how many devices, or that there are none
  — and appears only where the capability is on.
- `GuestForm`: one line under the tick boxes saying push is switched on by the
  reader on their own device, and that an iPhone must add the site to the Home
  Screen first. Not a control.

Not doing: a way for the owner to send a test notification, or to revoke one
device. Both are real, both are their own ticket.

## Acceptance

- A contact with two subscribed phones shows a mobile-notifications chip
  reading two devices; one with none says so; with push off the chip is absent.
- No chip or label is a whole sentence.
- `npm run verify`.
