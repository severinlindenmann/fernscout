---
id: B384
title: "A guest the owner adds by hand is a dead end: a bare code, no link, no way to be approved"
type: ISSUE
priority: high
complexity: medium
area: contacts, mail
found: "2026-09-04T21:57:31Z"
started: "2026-09-04T22:00:21Z"
session: 39691533-1e0d-44dd-a2e5-b2a7ce844518
claimed: "2026-09-04T22:00:21Z"
---

# B384 — A guest the owner adds by hand is a dead end: a bare code, no link, no way to be approved

## Why

The owner types somebody into "Add a guest" at `/<user>/contacts`. The row lands
in "Waiting for you" with `Waiting to be let in —`, and it stays there forever.

- `app/api/contacts/admin/route.ts:213` mails a six-digit code via
  `sendCodeMail`. That mail carries **no link** — `lib/contacts/mail.ts:70`
  renders two paragraphs and a number. On the public form the code makes sense
  because the person is already standing in front of the field that takes it;
  here it arrives unasked-for with nowhere to be typed. The recipient's only
  route in is to guess that they should visit `/<user>/contacts` themselves and
  start over, which issues a second code.
- Until they do, `confirmedAt` is null, so `approveContact` refuses
  (`route.ts:128`, `not_confirmed`) and the card offers only Edit and Delete.
  The owner sees a person waiting and no way to let them in.

So the one path an owner would reach for first — add the people I already know
— cannot complete without the guest independently working out what to do with a
number.

The machinery for what the owner actually wants already exists: B319's
pre-approved invite. `POST /api/v1/<user>/invites` with an email mails a link
(`sendInviteMail`), and when the person opens it and proves that exact address,
`app/api/contacts/redeem/route.ts:297` and `app/api/contacts/confirm/route.ts:69`
run `approveContact` immediately rather than queuing them. Clicking the link is
the approval.

`approveContact` staying the only thing that creates a grant is not in question
here, and neither is the rule that an unproved address is never approved: the
recipient still proves the address by opening a link only they received.

## Work

Make `create` in the admin route send an invitation instead of a bare code —
reuse `createInvite` + `sendInviteMail` (guest kind, the typed email) rather
than `issueCode` + `sendCodeMail`, so the address is pre-approved and one click
finishes it. Decide what the row looks like in the meantime: still `pending`,
but the card should say a link was sent and offer to resend, not sit silently.

Consider whether the owner should get the choice — invite now, or record the
person without mailing them yet. Adding somebody to an address book is not
always an intent to let them in today.

Not doing: changing the public form's code flow, or letting the owner approve an
unconfirmed row.

## Acceptance

Owner adds a guest by hand → that address receives a mail with a button → the
recipient clicks it, proves the address, and lands in **Approved** without the
owner doing anything further. The owner's page shows, before the click, that an
invitation is outstanding. A test covers the create → redeem → `active` path.
