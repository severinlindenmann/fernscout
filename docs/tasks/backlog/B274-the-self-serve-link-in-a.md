---
id: B274
title: The self-serve link in a reader's mail is labelled as a detail change when it is their standing way back
type: ISSUE
priority: low
complexity: low
area: contacts, mail, i18n
found: "2026-09-04T11:56:50Z"
---

# B274 — The self-serve link in a reader's mail is labelled as a detail change when it is their standing way back

## Why

The "Thank you" mail a confirmed reader gets carries
`/<user>/c/fs_manage_…` under the label **"Change or remove your details"**.

The owner asked whether it is permanent. **It is.** `manageTokenFor`
(`lib/contacts/index.ts:99-105`) is an HMAC of `manage:<owner>:<contactId>`
with no nonce and no expiry, so it is stable for the life of the contact row —
it changes only if the row is deleted or `contactsKey()` is rotated. The label
undersells it: a reader reasonably reads "change or remove your details" as a
one-time errand and does not keep the mail, and then has no way back except
asking to join again.

The owner suggested calling it *"Your Permanent Journal Link"*. **Do not use
that wording**, and the reason is the one this codebase already writes down
about a different link. `app/api/v1/journals/route.ts` on the owner's sign-in
link: *"Never hand it over as 'the address of your journal'. That is `url`.
Somebody forwarding what they think is an address would be forwarding a
session."* The same trap applies here and slightly worse — this token is
bearer-authority over one person's contact record, it never expires, and a
name with "Journal Link" in it is an invitation to paste it into a group chat.
It is also not a link to the journal: it opens a page about *them*.

So the label should say two true things the current one does not: that it is
theirs to keep, and that it is theirs alone.

## Work

- Relabel it in all three locales — something on the order of *"Your own page,
  keep this link"* with a line beneath saying it is personal and should not be
  forwarded. Wording is the deliverable here; get it right rather than short.
- Say the same thing on the page itself, so somebody who did forward it, and
  somebody who arrives months later, both learn what they are holding.
- Check the mail says plainly that the link keeps working. "Permanent" is the
  fact worth conveying; "Journal" is the word to avoid.
- While there: confirm the page genuinely does not grant reading access — the
  reading gate is a guest session, and this token is not one. If it does grant
  anything beyond editing their own record, that is a finding, not a rename,
  and belongs in its own capture.

## Acceptance

- The mail and the page both say the link is theirs to keep and not to forward,
  in all three locales.
- Neither calls it the journal's address or a way in.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
