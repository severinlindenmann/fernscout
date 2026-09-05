---
id: B384
title: "A guest the owner adds by hand is a dead end: a bare code, no link, no way to be approved"
type: ISSUE
priority: high
complexity: medium
area: contacts, mail
found: "2026-09-04T21:57:31Z"
started: "2026-09-04T22:00:21Z"
merged: "2026-09-04T22:14:28Z"
completed: "2026-09-05T09:12:43Z"
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

## Done

`case "create"` in `app/api/contacts/admin/route.ts` now calls `createInvite`
(kind `guest`, the typed name/locale/email) and `sendInviteMail` — the same
pair B319 already uses at `POST /api/v1/<user>/invites` — instead of
`issueCode` + `sendCodeMail`. The contact row's `createdVia` is set to
`invite:<id>` rather than `"owner"`, which is what makes
`preapprovedEmailFor` recognise the address the moment it confirms and run
`approveContact` inline in `redeem`/`confirm`, exactly as a self-served,
owner-mailed B319 link already does. Nothing about `approveContact` itself, or
about proof being required first, changed.

A new `case "resend"` reuses the *same* invite (found via `createdVia`,
decrypted through `listInvitesWithLinks`) rather than minting a second one, and
refuses when the contact has already confirmed (`already_confirmed`) or has no
invite behind it — a legacy `owner`-created row from before this fix
(`no_invite`) — or the invite is dead (`invite_unavailable`).

The stale ~line 210 comment ("the same six-digit code the public form sends
… an owner-created contact would be a dead end") is replaced; it described
exactly the bug this ticket is about.

**Not offering the owner a choice** ("invite now, or just record them") — the
Work section raised it as worth considering, and the answer is no, for now:
every other route into `requestContact` (the public form, every B33 redemption)
mails or shows something the moment the row is created, and a silent "just
record, don't tell them yet" state would be the first contact row on this
whole feature that intentionally sits invisible to its own subject. Owning a
mistake is one Delete away. Smallest UI that says so honestly, per the
Work section: a `contact.adminInvitePending` sentence plus a
`contact.adminResendInvite` button on the row itself — see `resendableInvite`
and `ContactRow` in `components/ContactsAdmin.tsx` — rather than a new panel.

### Acceptance, line by line

- "that address receives a mail with a button" — `sendInviteMail` renders a
  `{ kind: "button", href: input.url }` block (`lib/contacts/mail.ts:142`);
  `test/contacts-admin-invite.test.ts`'s first test asserts a file lands under
  `content/<user>/mail/` addressed to the recipient.
- "the recipient clicks it, proves the address, and lands in Approved" —
  the same test redeems the invite's own URL, confirms with the code, and
  asserts `result.body.status === "active"`, `approvedAt` is set, and a
  `access_grants` row exists — the exact chain `POST /invites` already proved
  for B319, now reached from the admin form instead.
- "without the owner doing anything further" — no `case "resend"` or
  `"approve"` call appears anywhere between `create` and the assertion.
- "the owner's page shows, before the click, that an invitation is
  outstanding" — `ContactRow` renders `contact.adminInvitePending` and a
  `contact.adminResendInvite` button whenever `resendableInvite()` finds a
  live invite behind an unconfirmed pending row (`components/ContactsAdmin.tsx`).
- "A test covers the create → redeem → active path" —
  `test/contacts-admin-invite.test.ts`, first `describe` block.

### Verification

- `npx vitest run test/contacts-admin-invite.test.ts` — 5/5 pass.
- `npx vitest run test/contacts.test.ts test/contacts-admin-guest-trip.test.tsx
  test/contact-provenance.test.tsx test/invite-preapproval.test.ts
  test/invite-links.test.ts` — 146/146 pass (no regression in the existing
  contacts/invite suites).
- `npm run verify` — build → tsc → eslint → vitest, all green (2782 passed, 3
  skipped Postgres-only tests, pre-existing unrelated eslint warnings only).

### Security review

A `claude-security` pass over the diff (`app/api/contacts/admin/route.ts`,
`components/ContactsAdmin.tsx`) found no authorization bypass, no IDOR, no
injection, no token leakage and no weakening of `approveContact`'s exclusivity
or of "proof required before approval". `getContact`/`listInvitesWithLinks`
stay scoped to the guarded `username` throughout; neither `create` nor
`resend` ever calls `approveContact` itself.

One low finding: `case "resend"` has no rate limit — an owner action, gated by
`guard()`, but nothing stops repeated real mail to the same address if that
session were ever scripted or compromised. Captured as **B388** rather than
folded into this ticket's scope, per the Work section's own "not doing" line
about the public form's already-limited code issuance being a different path.
