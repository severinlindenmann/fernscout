---
id: B1132
title: The address-confirmation mail says nothing opens yet, but a pre-approved invite admits the reader on confirming
type: ISSUE
priority: medium
complexity: low
area: mail, contacts, i18n
found: "2026-09-09T18:00:00Z"
started: "2026-09-11T13:21:55Z"
merged: "2026-09-11T13:48:22Z"
---

# B1132 — The address-confirmation mail says nothing opens yet, but a pre-approved invite admits the reader on confirming

Found during B102, driven against fernscout.ch on 2026-09-09.

## Why

An owner issues a guest invite with an `email` on it. Since B319 that address is
**pre-approved**: the API says so in its own words —

> Mailed to test@severin.io. That address is pre-approved: proving it is all
> that is left, and it will not sit in your queue.

The person opens the link, types their address, and the code mail that arrives
says (`site/locales/en.json:137`, `contact.mailCodeLinkBody`):

> Press the button and we will know this address is yours. **Nothing opens yet
> — whoever keeps the journal still decides who comes in.**

They press it. `POST /api/contacts/confirm` answers `{"ok":true,"status":
"active", …}` and they are in — immediately, with no queue and no second
decision, exactly as the invite promised. Verified on the live instance: the
same address could then read a `guest` trip that an anonymous fetch could not.

`lib/contacts/mail.ts:165` passes that string unconditionally. There is no
branch on whether the code was issued against a pre-approved invite, so the
sentence is right for the open guestbook path and wrong for every mailed
invite — and the mailed invite is the path an owner is most likely to use,
because it is the one an agent can drive for them.

The consequence is small but it is the kind this project has decided to care
about: the last thing the software says to a new reader, at the moment they are
deciding whether to trust it, is a description of what is about to happen that
does not happen.

## Work

Done. `app/api/contacts/redeem/route.ts`'s `!sessionEmail` branch now fetches
the contact just written (`getContactByEmail`) and calls `preapprovedEmailFor`
against its `createdVia`/`status` — the same call the signed-in branch already
made a few lines down — and passes the result to `sendCodeMail` as a new
`preapproved` argument.

`lib/contacts/mail.ts`'s `sendCodeMail` picks between
`contact.mailCodeLinkBody` (unchanged) and a new
`contact.mailCodeLinkBodyPreapproved` when `preapproved` is true. Added the key
to `site/locales/en.json`, `de.json` and `hu.json` (real German and Hungarian,
not machine-translated placeholders) and ran `npm run i18n:keys`.

Verified both mail bodies by decoding the `.eml` files `test-mail`'s file
transport writes (`test/invite-preapproval.test.ts`, new tests): a pre-approved
redemption's code mail says pressing the button is the whole of it and does
not say "Nothing opens yet"; a different address redeeming the same
pre-approved link (never itself pre-approved) still gets the ordinary
"Nothing opens yet" wording. English wording:

- Ordinary: "Press the button and we will know this address is yours. Nothing
  opens yet — whoever keeps the journal still decides who comes in."
- Pre-approved: "Press the button and we will know this address is yours — and
  that is the whole of it. This address was already approved, so you are in
  as soon as you press it."

## Acceptance

- Redeem a mailed, pre-approved guest invite on a running instance; the code
  mail does not say the owner still has to decide.
- Redeem through the open guestbook path; it still does.
