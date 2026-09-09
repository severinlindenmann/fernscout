---
id: B1132
title: The address-confirmation mail says nothing opens yet, but a pre-approved invite admits the reader on confirming
type: ISSUE
priority: medium
complexity: low
area: mail, contacts, i18n
found: "2026-09-09T18:00:00Z"
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

The code-issuing path already knows: `/api/contacts/redeem` resolves the invite
before it calls `issueCode` (`app/api/contacts/redeem/route.ts:345`). Carry that
one fact into the mail and pick between two strings — the existing one, and a
new one for the pre-approved case saying that pressing the button is the whole
of it.

Three locales, and `npm run i18n:keys` after adding the key. Real German and
real Hungarian, or leave the ticket short of done and say so.

## Acceptance

- Redeem a mailed, pre-approved guest invite on a running instance; the code
  mail does not say the owner still has to decide.
- Redeem through the open guestbook path; it still does.
