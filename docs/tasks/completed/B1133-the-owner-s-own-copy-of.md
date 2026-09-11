---
id: B1133
title: The owner's own copy of a day letter says they asked to be kept posted and offers no way to stop it
type: ISSUE
priority: low
complexity: low
area: mail, digest
found: "2026-09-09T18:00:03Z"
started: "2026-09-11T15:47:58Z"
merged: "2026-09-11T16:05:06Z"
completed: "2026-09-11T19:13:16Z"
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

Done. `lib/digest/dayLetter.ts`'s `renderDayLetter` now picks the footer by
whether the recipient carries a `manageToken`: a contact still gets
`digest.footer` ("You are getting this because you asked {site} to keep you
posted."), unchanged; the owner (`manageToken: null`) gets a new
`dayMail.ownerFooter` — "Sent to you because you published this day on {site}
with mail switched on." The `manage`/`unsubscribe` links and the
`List-Unsubscribe` header were already correctly absent for the owner (both
are derived from the same `manageToken`, which is `null` for them) — checked,
and that half was not wrong.

New key `dayMail.ownerFooter` in `site/locales/{en,de,hu}.json` (real German
and Hungarian, not machine-shaped), `npm run i18n:keys` re-run.

`test/day-mail.test.ts` gained a describe block, "the owner's own copy of the
letter" — publishes a day to an owner and one opted-in contact, reads both
raw `.eml` files out of the file-transport mailbox, and asserts: the owner's
body does not contain "you asked" or either link, and carries no
`List-Unsubscribe` header; the contact's is unchanged (still says "you asked",
still carries the header). Ran `npx vitest run test/day-mail.test.ts` —
32 passed.

## Acceptance

- Publish a day with `send_mail: true` on an instance where the owner and a
  contact are different addresses; read both copies. The owner's does not claim
  they asked to be kept posted, and does not offer a link that is not there.
