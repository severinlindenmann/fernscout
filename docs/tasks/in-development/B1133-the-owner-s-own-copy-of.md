---
id: B1133
title: The owner's own copy of a day letter says they asked to be kept posted and offers no way to stop it
type: ISSUE
priority: low
complexity: low
area: mail, digest
found: "2026-09-09T18:00:03Z"
started: "2026-09-11T15:47:58Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T15:47:58Z"
---

# B1133 — The owner's own copy of a day letter says they asked to be kept posted and offers no way to stop it

Found during B102, driven against fernscout.ch on 2026-09-09.

## Why

Publishing a day with `send_mail: true` sends the letter to the journal's owner
as well as to the contacts who opted in. The two copies are not the same
message, and the owner's is the worse one.

The contact's copy, read off the live instance:

```
List-Unsubscribe: <https://fernscout.ch/…/u/fs_manage_…>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
…
You are getting this because you asked … to keep you posted.
Change your language or stop these emails: …/c/fs_manage_…
Stop all emails: …/u/fs_manage_…
```

The owner's copy carries the same closing sentence — *"You are getting this
because you asked … to keep you posted"* — and no manage link, no stop link and
no `List-Unsubscribe` header at all.

Both halves are wrong in a small way. The owner did not ask to be kept posted;
they published the day, and the letter is a receipt. And the one sentence that
does appear invites them to go looking for a preference that is not there,
because `lib/digest/dayLetter.ts:352-357` derives both links from
`recipient.manageToken`, which is `null` for the owner
(`lib/digest/dayLetter.ts:159`) — correctly, since an owner is not a contact
and has no contact row to unsubscribe.

Low priority: it is the owner's own journal and nobody is trapped. It is worth
fixing because the footer is the only part of the letter that is untrue, and
because "we told them they asked for it" is the sentence a reader remembers.

## Work

Give the owner's recipient its own footer string — a line saying this is the
copy that goes to them because they published the day, and that `send_mail` is
what asked for it. Leave the contact footer exactly as it is.

Do not manufacture a manage token for the owner: there is nothing behind it.

Three locales, `npm run i18n:keys`.

## Acceptance

- Publish a day with `send_mail: true` on an instance where the owner and a
  contact are different addresses; read both copies. The owner's does not claim
  they asked to be kept posted, and does not offer a link that is not there.
